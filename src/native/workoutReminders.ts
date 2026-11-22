import { liveQuery } from 'dexie';
import { App as CapApp } from '@capacitor/app';
import { LocalNotifications } from '@capacitor/local-notifications';
import { db } from '@/db/db';
import { planUnsavedWorkoutReminders } from '@/features/workout/unsavedWorkoutPlan';

/**
 * Native (iOS app): "your workout is still open" notifications. Rebuilt from
 * the `workoutDrafts` table on every draft change and on resume, so saving or
 * discarding the workout cancels them, and every new set pushes them out.
 * Timing lives in the pure `planUnsavedWorkoutReminders()`.
 *
 * Gated on `settings.unsavedWorkoutReminder` (unset = on) and on notification
 * permission, which the rest timer asks for on the first rest of a workout.
 */

/** Our notification ids live in [ID_BASE, ID_BASE + 100). */
const ID_BASE = 2000;

let started = false;
let chain: Promise<void> = Promise.resolve();
let debounce: number | null = null;

async function rebuild(): Promise<void> {
  const pending = await LocalNotifications.getPending();
  const ours = pending.notifications.filter((n) => n.id >= ID_BASE && n.id < ID_BASE + 100);
  if (ours.length > 0) {
    await LocalNotifications.cancel({ notifications: ours.map((n) => ({ id: n.id })) });
  }

  const settings = await db.settings.get('singleton');
  if (settings?.unsavedWorkoutReminder === false) return;
  const perm = await LocalNotifications.checkPermissions();
  if (perm.display !== 'granted') return;

  const plan = planUnsavedWorkoutReminders({
    now: new Date(),
    drafts: await db.workoutDrafts.toArray(),
  });
  if (plan.length === 0) return;

  await LocalNotifications.schedule({
    notifications: plan.map((r, i) => ({
      id: ID_BASE + i,
      title: r.title,
      body: r.body,
      schedule: { at: r.at, allowWhileIdle: true },
      sound: 'chime.wav',
      extra: { url: r.url },
    })),
  });
}

function requestSync(): void {
  if (debounce !== null) window.clearTimeout(debounce);
  debounce = window.setTimeout(() => {
    debounce = null;
    chain = chain.then(rebuild).catch((err: unknown) => {
      console.error('Unsaved-workout reminder sync failed:', err);
    });
  }, 300);
}

export function startUnsavedWorkoutReminders(): void {
  if (started) return;
  started = true;

  liveQuery(async () => {
    const [drafts, settings] = await Promise.all([
      db.workoutDrafts.toArray(),
      db.settings.get('singleton'),
    ]);
    return [drafts.map((d) => d.updatedAt), settings?.unsavedWorkoutReminder];
  }).subscribe({
    next: () => requestSync(),
    error: (err: unknown) => console.error('Unsaved-workout watch failed:', err),
  });

  // Permission may have been granted in the meantime (e.g. by the rest timer).
  void CapApp.addListener('appStateChange', ({ isActive }) => {
    if (isActive) requestSync();
  });
}

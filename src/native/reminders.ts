import { liveQuery } from 'dexie';
import { App as CapApp } from '@capacitor/app';
import { LocalNotifications } from '@capacitor/local-notifications';
import { db } from '@/db/db';
import { todayISO } from '@/utils/dates';
import { planReminders } from '@/features/supplements/reminderPlan';

/**
 * Native (iOS app) reminders: hands iOS a queue of local notifications that
 * fire even when the app is closed. Replaces the web build's in-app 30 s tick
 * (`supplements/scheduler.ts`), which only works while the app is open.
 *
 * The queue is rebuilt from scratch on every relevant change — supplements,
 * logs from today on, settings, today's body measurement — and on every resume,
 * so it never drifts from what the app shows.
 */

/** Our notification ids live in [ID_BASE, ID_BASE + 1000). */
const ID_BASE = 1000;

let started = false;
let chain: Promise<void> = Promise.resolve();
let debounce: number | null = null;

async function rebuild(): Promise<void> {
  const pending = await LocalNotifications.getPending();
  const ours = pending.notifications.filter((n) => n.id >= ID_BASE && n.id < ID_BASE + 1000);
  if (ours.length > 0) {
    await LocalNotifications.cancel({ notifications: ours.map((n) => ({ id: n.id })) });
  }

  const settings = await db.settings.get('singleton');
  if (!settings?.notificationsEnabled) return;
  const perm = await LocalNotifications.checkPermissions();
  if (perm.display !== 'granted') return;

  const today = todayISO();
  const [supplements, logs, todaysBody] = await Promise.all([
    db.supplements.toArray(),
    db.supplementLogs.where('date').aboveOrEqual(today).toArray(),
    db.bodyMeasurements.where('date').equals(today).count(),
  ]);

  const plan = planReminders({
    now: new Date(),
    supplements,
    logs,
    body: settings.bodyReminderEnabled
      ? {
          enabled: true,
          dow: settings.bodyReminderDow ?? 0,
          time: settings.bodyReminderTime ?? '09:00',
          loggedToday: todaysBody > 0,
        }
      : null,
  });
  if (plan.length === 0) return;

  await LocalNotifications.schedule({
    notifications: plan.map((r, i) => ({
      id: ID_BASE + i,
      title: r.title,
      body: r.body,
      schedule: { at: r.at, allowWhileIdle: true },
      extra: { url: r.url },
    })),
  });
}

/** Coalesce bursts of changes into one rebuild; never run two at once. */
export function requestReminderSync(): void {
  if (debounce !== null) window.clearTimeout(debounce);
  debounce = window.setTimeout(() => {
    debounce = null;
    chain = chain.then(rebuild).catch((err: unknown) => {
      console.error('Reminder sync failed:', err);
    });
  }, 400);
}

export function startNativeReminders(): void {
  if (started) return;
  started = true;

  // Re-plan whenever anything the plan depends on changes.
  liveQuery(async () => {
    const today = todayISO();
    const [s, l, st, b] = await Promise.all([
      db.supplements.toArray(),
      db.supplementLogs.where('date').aboveOrEqual(today).toArray(),
      db.settings.get('singleton'),
      db.bodyMeasurements.where('date').equals(today).count(),
    ]);
    return [s, l, st, b];
  }).subscribe({
    next: () => requestReminderSync(),
    error: (err: unknown) => console.error('Reminder watch failed:', err),
  });

  // The day may have rolled over, or permission changed in iOS Settings.
  void CapApp.addListener('appStateChange', ({ isActive }) => {
    if (isActive) requestReminderSync();
  });

  // Tapping a notification opens the screen it is about.
  void LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
    const extra: unknown = action.notification.extra;
    if (extra && typeof extra === 'object' && 'url' in extra && typeof extra.url === 'string') {
      window.location.hash = extra.url.replace(/^#/, '');
    }
  });
}

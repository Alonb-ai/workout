import { App as CapApp } from '@capacitor/app';
import { LocalNotifications } from '@capacitor/local-notifications';
import { db } from '@/db/db';
import { useTimerStore } from '@/store/timer';
import { refreshNativePermission } from '@/hooks/useNotifications';
import { RestTimerNative } from './liveActivity';

/**
 * Native (iOS app) side of the rest timer. Mirrors the in-app timer store to:
 *
 *  1. A Live Activity — the countdown on the lock screen / Dynamic Island.
 *  2. A local notification at the end time, with the rest-end beep, so the
 *     phone rings even when it is locked or in another app. The in-app
 *     `GlobalRestTimerBar` beeps only while the web view is alive; iOS
 *     suspends it the moment the app leaves the foreground.
 *
 * The notification is marked `foreground: false`: while the app is open the
 * in-app beep already covers it, and a banner on top would be a double alert.
 *
 * Gated on `settings.restTimerLockScreen` (unset = on). The beep on the
 * notification follows `settings.restTimerSound`.
 */

/** Notification id reserved for the rest timer (reminders use 1000–1999). */
export const REST_NOTIFICATION_ID = 3000;

let started = false;
let chain: Promise<void> = Promise.resolve();
let endTimer: number | null = null;
let askedPermission = false;

function enqueue(job: () => Promise<void>): void {
  chain = chain.then(job).catch((err: unknown) => {
    console.error('Rest timer sync failed:', err);
  });
}

async function hasPermission(): Promise<boolean> {
  let perm = await LocalNotifications.checkPermissions();
  // Ask once, at the moment it obviously matters: the first rest of a workout.
  if (perm.display !== 'granted' && perm.display !== 'denied' && !askedPermission) {
    askedPermission = true;
    perm = await LocalNotifications.requestPermissions();
    void refreshNativePermission();
  }
  return perm.display === 'granted';
}

/** A build without the native plugin (or iOS < 16.2) must not break the timer. */
function endActivity(): Promise<void> {
  return RestTimerNative.end().catch(() => {});
}

async function clear(): Promise<void> {
  await endActivity();
  await LocalNotifications.cancel({ notifications: [{ id: REST_NOTIFICATION_ID }] });
}

async function sync(endsAt: number | null, totalSec: number, label: string): Promise<void> {
  if (endTimer !== null) {
    window.clearTimeout(endTimer);
    endTimer = null;
  }

  const settings = await db.settings.get('singleton');
  const enabled = settings?.restTimerLockScreen !== false;
  const now = Date.now();
  if (!endsAt || endsAt <= now || !enabled) {
    await clear();
    return;
  }

  // Take the countdown off the lock screen once it has run out (fires on
  // resume if the app was suspended; until then the activity shows "rest over").
  endTimer = window.setTimeout(() => {
    endTimer = null;
    enqueue(endActivity);
  }, endsAt - now);

  const startedAt = Math.min(endsAt, endsAt - totalSec * 1000);
  await RestTimerNative.start({ endsAt, startedAt, label }).catch((err: unknown) => {
    // A missing Live Activity must never cost the notification.
    console.warn('Live Activity unavailable:', err);
  });

  await LocalNotifications.cancel({ notifications: [{ id: REST_NOTIFICATION_ID }] });
  if (!(await hasPermission())) return;
  await LocalNotifications.schedule({
    notifications: [
      {
        id: REST_NOTIFICATION_ID,
        title: 'המנוחה נגמרה',
        body: label ? `${label} · הזמן לסט הבא` : 'הזמן לסט הבא',
        schedule: { at: new Date(endsAt), allowWhileIdle: true },
        ...(settings?.restTimerSound !== false ? { sound: 'rest-end.wav' } : {}),
        foreground: false,
        interruptionLevel: 'active',
        extra: { url: '/workout' },
      },
    ],
  });
}

export function startNativeRestTimer(): void {
  if (started) return;
  started = true;

  useTimerStore.subscribe((s, prev) => {
    if (s.endsAt === prev.endsAt && s.label === prev.label) return;
    const { endsAt, totalSec, label } = s;
    enqueue(() => sync(endsAt, totalSec, label));
  });

  // On resume, drop a countdown that ran out while we were suspended.
  void CapApp.addListener('appStateChange', ({ isActive }) => {
    if (!isActive) return;
    const { endsAt, totalSec, label } = useTimerStore.getState();
    enqueue(() => sync(endsAt, totalSec, label));
  });

  // A cold start never has a running timer; clear anything left by a crash.
  enqueue(clear);
}

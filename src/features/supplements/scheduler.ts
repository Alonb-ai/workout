import { db } from '@/db/db';
import { todayISO } from '@/utils/dates';
import { format } from 'date-fns';
import { showNotification } from '@/hooks/useNotifications';
import type { Supplement } from '@/types';

/**
 * In-app supplement notifier.
 *
 * Web Push background scheduling is unreliable across platforms, so we run a
 * lightweight foreground checker that:
 *   1) On startup, fires any missed notifications from the past 60 minutes.
 *   2) Every 30s while the app is open, checks if any dose's time has passed
 *      since the last check and hasn't been logged → fires a notification.
 *
 * iOS PWA NOTE: Notifications only display when the app is installed to home
 * screen AND the SW is active. Outside an installed PWA, this falls back to
 * showing only in-app alerts.
 */

const NOTIFIED_KEY = 'iron-track:notified';

interface NotifiedMap {
  [key: string]: number; // key = `${supplementId}|${date}|${time}` → timestamp
}

function readNotified(): NotifiedMap {
  try {
    const raw = sessionStorage.getItem(NOTIFIED_KEY);
    return raw ? (JSON.parse(raw) as NotifiedMap) : {};
  } catch {
    return {};
  }
}

function writeNotified(m: NotifiedMap): void {
  try {
    sessionStorage.setItem(NOTIFIED_KEY, JSON.stringify(m));
  } catch {
    // ignore quota errors
  }
}

let scheduled = false;

export function startSupplementScheduler(): void {
  if (scheduled) return;
  scheduled = true;
  void tick();
  setInterval(() => void tick(), 30_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void tick();
  });
}

async function tick(): Promise<void> {
  const settings = await db.settings.get('singleton');
  if (!settings?.notificationsEnabled) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

  const sups = await db.supplements.filter((s) => s.active).toArray();
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const notified = readNotified();

  // Today's window.
  await checkDayWindow(sups, todayISO(), now.getDay(), currentMinutes, notified);

  // Cross-midnight catch-up: if we're inside the 6-hour late window from
  // some hour that ended yesterday (i.e., currentMinutes < 360), also scan
  // yesterday's schedule with a clock that pretends we're at now+24h. This
  // catches a 23:50 dose that the user missed because they closed the app.
  if (currentMinutes < 6 * 60) {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    // Local date — toISOString() would shift another day back before 03:00 in UTC+3.
    const yIso = format(yesterday, 'yyyy-MM-dd');
    await checkDayWindow(sups, yIso, yesterday.getDay(), currentMinutes + 1440, notified);
  }

  // Body-measurement weekly reminder. Same 6h late window + per-day dedup.
  if (settings.bodyReminderEnabled) {
    await checkBodyReminder(settings.bodyReminderDow ?? 0, settings.bodyReminderTime ?? '09:00',
      now, currentMinutes, notified);
  }

  writeNotified(notified);
}

async function checkBodyReminder(
  dow: number,
  time: string,
  now: Date,
  currentMinutes: number,
  notified: NotifiedMap,
): Promise<void> {
  if (now.getDay() !== dow) return;
  const [h, m] = time.split(':').map(Number);
  if (h === undefined || m === undefined) return;
  const sched = h * 60 + m;
  if (sched > currentMinutes) return;
  if (currentMinutes - sched > 6 * 60) return;
  const date = todayISO();
  const key = `body|${date}|${time}`;
  if (notified[key]) return;
  // Skip the nudge if today already has a measurement logged.
  const todays = await db.bodyMeasurements.where('date').equals(date).toArray();
  if (todays.length > 0) return;
  try {
    await showNotification('תזכורת — שקול את עצמך', {
      body: 'שמירה על מדידות שבועיות עוזרת לעקוב אחרי מגמות.',
      tag: key,
      data: { url: '/#/body' },
    });
    notified[key] = Date.now();
  } catch {
    // silent
  }
}

async function checkDayWindow(
  sups: Supplement[],
  date: string,
  dow: number,
  currentMinutes: number,
  notified: NotifiedMap,
): Promise<void> {
  const logs = await db.supplementLogs.where('date').equals(date).toArray();
  const loggedSet = new Set(logs.map((l) => `${l.supplementId}|${l.scheduledTime}`));

  for (const sup of sups) {
    if (sup.daysOfWeek.length > 0 && !sup.daysOfWeek.includes(dow)) continue;
    for (const time of sup.times) {
      const [h, m] = time.split(':').map(Number);
      if (h === undefined || m === undefined) continue;
      const sched = h * 60 + m;
      // Only fire if time has passed AND within the last 6 hours AND not yet logged.
      if (sched > currentMinutes) continue;
      if (currentMinutes - sched > 6 * 60) continue;
      const key = `${sup.id}|${date}|${time}`;
      if (notified[key]) continue;
      if (loggedSet.has(`${sup.id}|${time}`)) continue;
      try {
        await showNotification(`תזכורת תוסף: ${sup.name}`, {
          body: `${sup.dose} ${sup.unit}${sup.withFood ? ' · עם אוכל' : ''} (תזמון ${time})`,
          // Same tag the Worker uses (worker/src/index.ts) so the OS replaces the
          // background push for this dose instead of stacking a second banner.
          tag: `iron-track:${sup.name}:${time}`,
          data: { supplementId: sup.id, time },
        });
        notified[key] = Date.now();
      } catch {
        // silent
      }
    }
  }
}

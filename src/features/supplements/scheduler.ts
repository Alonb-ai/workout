import { db } from '@/db/db';
import { todayISO } from '@/utils/dates';
import { showNotification } from '@/hooks/useNotifications';

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

  const date = todayISO();
  const sups = await db.supplements.filter((s) => s.active).toArray();
  const dow = new Date().getDay();
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const notified = readNotified();
  const logs = await db.supplementLogs
    .where('date')
    .equals(date)
    .toArray();
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
          tag: key,
          data: { supplementId: sup.id, time },
        });
        notified[key] = Date.now();
      } catch {
        // silent
      }
    }
  }
  writeNotified(notified);
}

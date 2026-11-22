import { addDays, format } from 'date-fns';
import type { Supplement, SupplementLog } from '@/types';

/**
 * Decides which OS notifications the native iOS app should have queued.
 *
 * The web build fires reminders from a 30 s in-app tick, which dies the moment
 * the app is closed. The native app instead hands iOS a list of one-shot
 * notifications that fire on their own. Pure function so it can be tested
 * without a device.
 *
 * Why one-shot (`at`) and not repeating triggers: a repeating trigger can't skip
 * a single day, so a dose already ticked off in the app would still ping. This
 * list leaves out anything already logged, and is rebuilt whenever the
 * supplements, today's logs or the settings change, and on every app resume.
 *
 * iOS keeps at most 64 pending local notifications per app, so the list is
 * sorted by time and capped (`max`). The horizon is long enough that a week
 * without opening the app still gets reminders.
 */

export interface PlannedReminder {
  at: Date;
  title: string;
  body: string;
  /** Hash route to open when the notification is tapped. */
  url: string;
  /** Stable identity, used by the tests and for OS grouping. */
  key: string;
}

export interface ReminderPlanInput {
  now: Date;
  supplements: Supplement[];
  /** Logs on or after today. Anything logged is not reminded. */
  logs: Pick<SupplementLog, 'supplementId' | 'date' | 'scheduledTime'>[];
  body: { enabled: boolean; dow: number; time: string; loggedToday: boolean } | null;
  horizonDays?: number;
  max?: number;
}

/** iOS allows 64 pending; leave headroom for anything else the app queues. */
export const MAX_PENDING_REMINDERS = 60;
export const REMINDER_HORIZON_DAYS = 14;

function parseHM(time: string): { h: number; m: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return { h, m };
}

function at(day: Date, h: number, m: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0);
}

export function planReminders(input: ReminderPlanInput): PlannedReminder[] {
  const horizon = input.horizonDays ?? REMINDER_HORIZON_DAYS;
  const max = input.max ?? MAX_PENDING_REMINDERS;
  const nowMs = input.now.getTime();
  const logged = new Set(input.logs.map((l) => `${l.supplementId}|${l.date}|${l.scheduledTime}`));
  const out: PlannedReminder[] = [];

  for (let d = 0; d < horizon; d++) {
    const day = addDays(input.now, d);
    const date = format(day, 'yyyy-MM-dd');
    const dow = day.getDay();

    for (const sup of input.supplements) {
      if (!sup.active) continue;
      if (sup.daysOfWeek.length > 0 && !sup.daysOfWeek.includes(dow)) continue;
      for (const time of sup.times) {
        const hm = parseHM(time);
        if (!hm) continue;
        const when = at(day, hm.h, hm.m);
        if (when.getTime() <= nowMs) continue;
        if (logged.has(`${sup.id}|${date}|${time}`)) continue;
        out.push({
          at: when,
          // Same wording as the in-app scheduler (scheduler.ts).
          title: `תזכורת תוסף: ${sup.name}`,
          body: `${sup.dose} ${sup.unit}${sup.withFood ? ' · עם אוכל' : ''} (תזמון ${time})`,
          url: '#/supplements',
          key: `${sup.id}|${date}|${time}`,
        });
      }
    }

    const body = input.body;
    if (body?.enabled && body.dow === dow && !(d === 0 && body.loggedToday)) {
      const hm = parseHM(body.time);
      if (hm) {
        const when = at(day, hm.h, hm.m);
        if (when.getTime() > nowMs) {
          out.push({
            at: when,
            title: 'תזכורת — שקול את עצמך',
            body: 'שמירה על מדידות שבועיות עוזרת לעקוב אחרי מגמות.',
            url: '#/body',
            key: `body|${date}|${body.time}`,
          });
        }
      }
    }
  }

  out.sort((a, b) => a.at.getTime() - b.at.getTime());
  return out.slice(0, max);
}

import {
  differenceInCalendarDays,
  format,
  parseISO,
  startOfDay,
  isToday,
  isYesterday,
} from 'date-fns';
import { he } from 'date-fns/locale';
import type { ISODate } from '@/types';

export function todayISO(): ISODate {
  return format(startOfDay(new Date()), 'yyyy-MM-dd');
}

export function formatHebDate(iso: ISODate): string {
  const d = parseISO(iso);
  if (isToday(d)) return 'היום';
  if (isYesterday(d)) return 'אתמול';
  return format(d, 'EEEE, d בMMMM', { locale: he });
}

export function formatHebDateFull(iso: ISODate): string {
  return format(parseISO(iso), 'EEEE, d בMMMM yyyy', { locale: he });
}

export function formatHM(seconds: number): string {
  if (seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export const DAYS_HE_SHORT = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];

/**
 * Whole days since the most recent completed session. 0 = trained today,
 * 1 = yesterday. `null` when there is no session at all.
 *
 * This replaced a consecutive-day streak, which is the wrong metric for a
 * 4-days-a-week lifter: it read 1 almost every day and 0 on every rest day, so
 * it carried no information. "Days since" answers the question he actually has.
 */
export function daysSinceLastWorkout(dates: ISODate[], now: Date = new Date()): number | null {
  if (dates.length === 0) return null;
  const last = dates.reduce((max, d) => (d > max ? d : max));
  // differenceInCalendarDays, not raw ms, so DST transitions can't shift a day.
  return Math.max(0, differenceInCalendarDays(startOfDay(now), parseISO(last)));
}

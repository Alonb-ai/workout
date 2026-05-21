import { format, parseISO, startOfDay, differenceInCalendarDays, isToday, isYesterday } from 'date-fns';
import { he } from 'date-fns/locale';
import type { ISODate } from '@/types';

export function todayISO(): ISODate {
  return format(startOfDay(new Date()), 'yyyy-MM-dd');
}

export function toISO(d: Date): ISODate {
  return format(startOfDay(d), 'yyyy-MM-dd');
}

export function formatHebDate(iso: ISODate): string {
  const d = parseISO(iso);
  if (isToday(d)) return 'היום';
  if (isYesterday(d)) return 'אתמול';
  return format(d, 'EEEE, d בMMMM', { locale: he });
}

export function formatHebDateShort(iso: ISODate): string {
  return format(parseISO(iso), 'd בMMM', { locale: he });
}

export function formatHebDateFull(iso: ISODate): string {
  return format(parseISO(iso), 'EEEE, d בMMMM yyyy', { locale: he });
}

export function daysBetween(a: ISODate, b: ISODate): number {
  return differenceInCalendarDays(parseISO(a), parseISO(b));
}

export function formatHM(seconds: number): string {
  if (seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export const DAYS_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
export const DAYS_HE_SHORT = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];

/** Compute current streak in days where at least one completed session exists. */
export function computeStreak(dates: ISODate[]): number {
  if (dates.length === 0) return 0;
  const set = new Set(dates);
  let streak = 0;
  let cursor = startOfDay(new Date());
  // Allow today to be missing — start counting from yesterday if today empty.
  if (!set.has(format(cursor, 'yyyy-MM-dd'))) {
    cursor = new Date(cursor.getTime() - 86400000);
  }
  while (set.has(format(cursor, 'yyyy-MM-dd'))) {
    streak += 1;
    cursor = new Date(cursor.getTime() - 86400000);
  }
  return streak;
}

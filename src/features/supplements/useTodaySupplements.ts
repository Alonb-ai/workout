import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import { todayISO } from '@/utils/dates';
import { parseISO } from 'date-fns';
import type { ISODate, Supplement, SupplementLog } from '@/types';

export interface TodayRow {
  supplement: Supplement;
  scheduledTime: string;
  log?: SupplementLog;
}

/**
 * Build a supplement timeline for the given date. Defaults to today.
 * - Filters by each supplement's day-of-week schedule for the given date.
 * - Attaches any matching log entry (taken/skipped) for the date.
 */
export function useDaySupplements(date: ISODate = todayISO()): TodayRow[] {
  const data = useLiveQuery(async () => {
    const dow = parseISO(date).getDay();
    const sups = await db.supplements.filter((s) => s.active).sortBy('order');
    const logs = await db.supplementLogs.where('date').equals(date).toArray();
    const rows: TodayRow[] = [];
    for (const s of sups) {
      if (s.daysOfWeek.length > 0 && !s.daysOfWeek.includes(dow)) continue;
      for (const time of s.times) {
        const log = logs.find((l) => l.supplementId === s.id && l.scheduledTime === time);
        rows.push({ supplement: s, scheduledTime: time, ...(log ? { log } : {}) });
      }
    }
    rows.sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime));
    return rows;
  }, [date]);
  return data ?? [];
}

/** Back-compat alias. */
export const useTodaySupplements = (): TodayRow[] => useDaySupplements();

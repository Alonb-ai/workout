import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import { todayISO } from '@/utils/dates';
import type { Supplement, SupplementLog } from '@/types';

export interface TodayRow {
  supplement: Supplement;
  scheduledTime: string;
  log?: SupplementLog;
}

/** Build today's supplement timeline rows (one per scheduled dose). */
export function useTodaySupplements(): TodayRow[] {
  const data = useLiveQuery(async () => {
    const date = todayISO();
    const dow = new Date().getDay();
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
  }, []);
  return data ?? [];
}

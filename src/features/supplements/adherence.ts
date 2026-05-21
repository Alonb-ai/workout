import type { Supplement, SupplementLog } from '@/types';
import { format, parseISO, subDays } from 'date-fns';

export interface AdherenceResult {
  weeklyPct: number;
  monthlyPct: number;
  weekly: { date: string; pct: number }[]; // last 30 days for chart
}

function expectedDoses(sups: Supplement[], date: Date): number {
  const dow = date.getDay();
  let total = 0;
  for (const s of sups) {
    if (!s.active) continue;
    if (s.daysOfWeek.length > 0 && !s.daysOfWeek.includes(dow)) continue;
    total += s.times.length;
  }
  return total;
}

export function computeAdherence(
  sups: Supplement[],
  logs: SupplementLog[],
  today: string,
): AdherenceResult {
  const todayD = parseISO(today);
  const logByDate = new Map<string, SupplementLog[]>();
  for (const l of logs) {
    const arr = logByDate.get(l.date) ?? [];
    arr.push(l);
    logByDate.set(l.date, arr);
  }

  const series: { date: string; pct: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = subDays(todayD, i);
    const ds = format(d, 'yyyy-MM-dd');
    const expected = expectedDoses(sups, d);
    const taken = (logByDate.get(ds) ?? []).filter((l) => l.status === 'taken').length;
    const pct = expected === 0 ? 100 : Math.round((Math.min(taken, expected) / expected) * 100);
    series.push({ date: ds, pct });
  }

  const last7 = series.slice(-7);
  const last30 = series;
  const avg = (arr: { pct: number }[]) =>
    arr.length === 0 ? 0 : Math.round(arr.reduce((s, x) => s + x.pct, 0) / arr.length);

  return {
    weeklyPct: avg(last7),
    monthlyPct: avg(last30),
    weekly: last30,
  };
}

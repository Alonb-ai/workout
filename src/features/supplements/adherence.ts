import type { Supplement, SupplementLog } from '@/types';
import { endOfDay, format, parseISO, subDays } from 'date-fns';

export interface AdherenceResult {
  /** null when nothing was ever scheduled — "no data", not "0% taken". */
  weeklyPct: number | null;
  monthlyPct: number | null;
  weekly: { date: string; pct: number }[]; // last 30 days for chart
}

/**
 * Supplements that were expected on `date`. Skips ones created after that day so
 * adding a supplement today doesn't retroactively fail the last 30 days.
 * ponytail: uses the *current* schedule for past days — no historical schedule is
 * stored. Editing times/days still rewrites history; add versioning if that bites.
 */
function scheduledOn(sups: Supplement[], date: Date): Supplement[] {
  const dow = date.getDay();
  const dayEnd = endOfDay(date).getTime();
  return sups.filter(
    (s) =>
      s.active &&
      s.createdAt <= dayEnd &&
      (s.daysOfWeek.length === 0 || s.daysOfWeek.includes(dow)),
  );
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

  const series: { date: string; pct: number; expected: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = subDays(todayD, i);
    const ds = format(d, 'yyyy-MM-dd');
    const due = scheduledOn(sups, d);
    const dueIds = new Set(due.map((s) => s.id));
    const expected = due.reduce((n, s) => n + s.times.length, 0);
    // Only logs of supplements still expected that day — logs of deleted ones stay
    // in the DB by design and would otherwise inflate the ratio past 100%.
    const taken = (logByDate.get(ds) ?? []).filter(
      (l) => l.status === 'taken' && dueIds.has(l.supplementId),
    ).length;
    // min(): a removed time slot can leave more logs than slots for that day.
    const pct = expected === 0 ? 100 : Math.round((Math.min(taken, expected) / expected) * 100);
    series.push({ date: ds, pct, expected });
  }

  // Aggregate only over days that actually had doses due, and exclude today —
  // its evening doses can't have been taken yet. Today is still plotted.
  const scorable = (arr: typeof series) => arr.filter((x) => x.expected > 0);
  // null, not 0: with nothing ever scheduled there is nothing to adhere to, and
  // showing a big "0%" made "you have no supplements" look like "you missed
  // every dose". The UI renders null as "—".
  const avg = (arr: { pct: number }[]) =>
    arr.length === 0 ? null : Math.round(arr.reduce((s, x) => s + x.pct, 0) / arr.length);

  return {
    weeklyPct: avg(scorable(series.slice(-8, -1))),
    monthlyPct: avg(scorable(series.slice(0, -1))),
    weekly: series,
  };
}

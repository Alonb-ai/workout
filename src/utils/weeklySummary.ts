import { addDays, format, parseISO, startOfWeek } from 'date-fns';
import type { BodyMeasurement, ExerciseLog, ISODate, Session, SetLog } from '@/types';
import {
  buildExerciseHistories,
  formatTopSets,
  repsToIncrease,
  type ExercisePoint,
} from './progressMetrics';

/**
 * The weekly summary: one calendar week (Sunday → Saturday, the Israeli week)
 * against the week before it.
 *
 * Built on the same per-exercise histories as the strength index
 * (progressMetrics.ts), so "stronger this week" means the same thing on both
 * screens: each exercise compared with itself, weight × reps.
 */

export interface MuscleWeek {
  name: string;
  /** Completed working sets (reps > 0). */
  sets: number;
  /** Σ weight × reps, net kg. */
  volume: number;
  prevSets: number;
  prevVolume: number;
}

export type PrKind = 'weight' | 'strength' | 'reps';

export interface WeekPr {
  exerciseId: string;
  name: string;
  kind: PrKind;
  /** "62.5 × 10/10/9" — the outing that set it. */
  detail: string;
  date: ISODate;
}

export interface StuckLift {
  exerciseId: string;
  name: string;
  /** "62.5 × 10/10/9" — the latest outing. */
  detail: string;
  /** Outings in a row without improvement (≥ 3). */
  outings: number;
  /** Reps still missing before the next weight increase; null for bodyweight. */
  repsToIncrease: number | null;
}

export interface WeeklySummary {
  weekStart: ISODate;
  /** Saturday, inclusive. */
  weekEnd: ISODate;
  sessions: number;
  prevSessions: number;
  sets: number;
  prevSets: number;
  volume: number;
  prevVolume: number;
  muscles: MuscleWeek[];
  prs: WeekPr[];
  stuck: StuckLift[];
  /**
   * Typical per-exercise change this week vs each exercise's previous outing
   * before the week, in %. Null when nothing trained this week had history.
   */
  strengthChangePct: number | null;
  /** Exercises behind `strengthChangePct`. */
  compared: number;
  /** Latest weigh-in in the week minus the latest one before it, kg. */
  bodyWeightChange: number | null;
}

/** Sunday of the week containing `date`. */
export function weekStartOf(date: ISODate | Date): ISODate {
  const d = typeof date === 'string' ? parseISO(date) : date;
  return format(startOfWeek(d, { weekStartsOn: 0 }), 'yyyy-MM-dd');
}

export function shiftWeek(weekStart: ISODate, weeks: number): ISODate {
  return format(addDays(parseISO(weekStart), weeks * 7), 'yyyy-MM-dd');
}

/** Same ±1.5 % noise band the per-exercise trend list uses. */
const IMPROVE_EPS = 0.005;
const STUCK_MIN_OUTINGS = 3;

export function buildWeeklySummary(args: {
  sessions: Session[];
  logs: ExerciseLog[];
  sets: SetLog[];
  weekStart: ISODate;
  measurements?: BodyMeasurement[];
}): WeeklySummary {
  const { sessions, logs, sets, weekStart } = args;
  const weekEnd = shiftWeek(weekStart, 1); // exclusive
  const prevStart = shiftWeek(weekStart, -1);
  const inWeek = (d: ISODate) => d >= weekStart && d < weekEnd;
  const inPrev = (d: ISODate) => d >= prevStart && d < weekStart;

  const completed = sessions.filter((s) => s.status === 'completed');
  const sessById = new Map(completed.map((s) => [s.id, s]));

  // ── Counts, volume and muscles, straight from the set logs ──────────────
  const logById = new Map(logs.map((l) => [l.id, l]));
  const muscles = new Map<string, MuscleWeek>();
  let setsCur = 0;
  let setsPrev = 0;
  let volCur = 0;
  let volPrev = 0;
  for (const s of sets) {
    if (!s.completed || s.reps <= 0) continue;
    const sess = sessById.get(s.sessionId);
    if (!sess) continue;
    const cur = inWeek(sess.date);
    const prev = !cur && inPrev(sess.date);
    if (!cur && !prev) continue;
    const vol = s.weight * s.reps;
    const work = s.isDrop ? 0 : 1; // drop sets add volume, not sets
    const name = logById.get(s.exerciseLogId)?.muscleGroupName?.trim() || 'אחר';
    let m = muscles.get(name);
    if (!m) {
      m = { name, sets: 0, volume: 0, prevSets: 0, prevVolume: 0 };
      muscles.set(name, m);
    }
    if (cur) {
      setsCur += work;
      volCur += vol;
      m.sets += work;
      m.volume += vol;
    } else {
      setsPrev += work;
      volPrev += vol;
      m.prevSets += work;
      m.prevVolume += vol;
    }
  }

  // ── Per-exercise: PRs, stuck lifts, strength change ─────────────────────
  const histories = buildExerciseHistories(completed, logs, sets);
  const prs: WeekPr[] = [];
  const stuck: StuckLift[] = [];
  const ratios: number[] = [];

  for (const [exerciseId, pts] of histories) {
    const weekPts = pts.filter((p) => inWeek(p.date));
    if (weekPts.length === 0) continue;
    const firstIdx = pts.indexOf(weekPts[0]!);
    const before = pts.slice(0, firstIdx);
    const last = weekPts[weekPts.length - 1]!;

    const pr = bestPr(before, weekPts);
    if (pr) prs.push({ exerciseId, name: last.name, ...pr });

    const prevOuting = before[before.length - 1];
    if (prevOuting && prevOuting.kind === last.kind && prevOuting.measure > 0 && last.measure > 0) {
      ratios.push(Math.min(2, Math.max(0.5, last.measure / prevOuting.measure)));
    }

    // Only judge "stuck" on what the user is doing now: everything up to the
    // last outing of this week.
    const upTo = pts.slice(0, pts.indexOf(last) + 1);
    const run = flatRun(upTo);
    if (run >= STUCK_MIN_OUTINGS) {
      stuck.push({
        exerciseId,
        name: last.name,
        detail: formatTopSets(last),
        outings: run,
        repsToIncrease: repsToIncrease(last),
      });
    }
  }

  const prevSessions = completed.filter((s) => inPrev(s.date)).length;
  const curSessions = completed.filter((s) => inWeek(s.date)).length;

  return {
    weekStart,
    weekEnd: format(addDays(parseISO(weekStart), 6), 'yyyy-MM-dd'), // inclusive Saturday
    sessions: curSessions,
    prevSessions,
    sets: setsCur,
    prevSets: setsPrev,
    volume: Math.round(volCur),
    prevVolume: Math.round(volPrev),
    muscles: [...muscles.values()]
      .map((m) => ({ ...m, volume: Math.round(m.volume), prevVolume: Math.round(m.prevVolume) }))
      .sort((a, b) => b.sets - a.sets || b.volume - a.volume || a.name.localeCompare(b.name)),
    prs: prs.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
    // Closest to a weight increase first — that's the one worth pushing.
    stuck: stuck.sort(
      (a, b) => (a.repsToIncrease ?? 99) - (b.repsToIncrease ?? 99) || b.outings - a.outings,
    ),
    strengthChangePct:
      ratios.length > 0 ? Math.round((geoMean(ratios) - 1) * 1000) / 10 : null,
    compared: ratios.length,
    bodyWeightChange: bodyChange(args.measurements ?? [], weekStart, weekEnd),
  };
}

/**
 * The strongest record set during the week, if any. Needs history: a first
 * outing is "new", never a PR. A heavier top weight is the headline record;
 * failing that, the best weight × reps (mean Epley at the top weight); for
 * bodyweight lifts, the most reps.
 */
function bestPr(
  before: ExercisePoint[],
  weekPts: ExercisePoint[],
): Omit<WeekPr, 'exerciseId' | 'name'> | null {
  if (before.length === 0) return null;
  let best: Omit<WeekPr, 'exerciseId' | 'name'> | null = null;
  const rank: Record<PrKind, number> = { weight: 3, strength: 2, reps: 1 };
  const history = before.slice();
  for (const p of weekPts) {
    const maxTop = Math.max(...history.map((h) => h.topWeight));
    const sameKind = history.filter((h) => h.kind === p.kind);
    const maxMeasure = sameKind.length > 0 ? Math.max(...sameKind.map((h) => h.measure)) : null;
    let kind: PrKind | null = null;
    if (p.kind === 'load' && p.topWeight > maxTop + 0.01) kind = 'weight';
    else if (maxMeasure !== null && p.measure > maxMeasure * (1 + IMPROVE_EPS)) {
      kind = p.kind === 'load' ? 'strength' : 'reps';
    }
    if (kind && (!best || rank[kind] >= rank[best.kind])) {
      best = { kind, detail: formatTopSets(p), date: p.date };
    }
    history.push(p);
  }
  return best;
}

/**
 * How many outings in a row, ending at the latest, show no improvement over
 * the first of them — in top weight, total volume, or reps at the top weight.
 * Mirrors `detectStall`, but counts the run instead of stopping at 3.
 */
function flatRun(pts: ExercisePoint[]): number {
  if (pts.length < 2) return pts.length;
  let start = pts.length - 1;
  // Walk back while the window [start-1 … end] has no improvement over its first.
  while (start > 0) {
    const base = pts[start - 1]!;
    const window = pts.slice(start);
    const improved = window.some(
      (p) =>
        p.topWeight > base.topWeight + 0.01 ||
        p.volume > base.volume + 0.5 ||
        (p.topWeight === base.topWeight && maxOf(p.topReps) > maxOf(base.topReps)),
    );
    if (improved) break;
    start--;
  }
  return pts.length - start;
}

function bodyChange(list: BodyMeasurement[], weekStart: ISODate, weekEnd: ISODate): number | null {
  const sorted = list.slice().sort((a, b) =>
    a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.createdAt - b.createdAt,
  );
  const inWeek = sorted.filter((m) => m.date >= weekStart && m.date < weekEnd);
  const before = sorted.filter((m) => m.date < weekStart);
  const cur = inWeek[inWeek.length - 1];
  const prev = before[before.length - 1];
  if (!cur || !prev) return null;
  return Math.round((cur.bodyWeight - prev.bodyWeight) * 10) / 10;
}

function maxOf(xs: number[]): number {
  return xs.reduce((m, x) => Math.max(m, x), 0);
}

function geoMean(xs: number[]): number {
  return Math.exp(xs.reduce((s, x) => s + Math.log(x), 0) / xs.length);
}

/** Plain-text version for the share sheet (AI analysis or a friend). */
export function weeklySummaryText(s: WeeklySummary, weekLabel: string): string {
  const lines: string[] = [];
  lines.push(`סיכום שבועי · ${weekLabel}`);
  lines.push(`אימונים: ${s.sessions} (שבוע קודם ${s.prevSessions})`);
  lines.push(`סטים: ${s.sets} · נפח: ${s.volume.toLocaleString('he-IL')} ק״ג`);
  if (s.strengthChangePct !== null) {
    lines.push(`שינוי כוח מול הביצוע הקודם: ${s.strengthChangePct > 0 ? '+' : ''}${s.strengthChangePct}%`);
  }
  if (s.bodyWeightChange !== null) {
    lines.push(`משקל גוף: ${s.bodyWeightChange > 0 ? '+' : ''}${s.bodyWeightChange} ק״ג`);
  }
  if (s.muscles.some((m) => m.sets > 0)) {
    lines.push('', 'סטים לפי שריר:');
    for (const m of s.muscles) {
      if (m.sets === 0) continue;
      lines.push(`- ${m.name}: ${m.sets} סטים, ${m.volume.toLocaleString('he-IL')} ק״ג`);
    }
  }
  if (s.prs.length > 0) {
    lines.push('', 'שיאים:');
    for (const p of s.prs) lines.push(`- ${p.name}: ${p.detail} (${PR_LABEL[p.kind]})`);
  }
  if (s.stuck.length > 0) {
    lines.push('', 'תקועים:');
    for (const x of s.stuck) {
      const need = x.repsToIncrease !== null && x.repsToIncrease > 0 ? `, חסרות ${x.repsToIncrease} חזרות להעלאה` : '';
      lines.push(`- ${x.name}: ${x.detail}, ${x.outings} אימונים בלי שיפור${need}`);
    }
  }
  return lines.join('\n');
}

export const PR_LABEL: Record<PrKind, string> = {
  weight: 'משקל שיא',
  strength: 'שיא משקל × חזרות',
  reps: 'שיא חזרות',
};

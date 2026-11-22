import type { ExerciseLog, ISODate, Session, SetLog } from '@/types';
import { epley1RM } from './scoring';

/**
 * Progress metrics that answer "am I getting stronger?" without the swings of
 * the per-session score.
 *
 * The owner's own definition of progress is weight × reps per exercise under
 * double progression: add reps at a weight until the target is met, then add
 * weight. So every number here is built from one exercise compared with
 * *itself*, and a skipped or newly-added exercise contributes nothing instead
 * of dragging a session-wide figure down.
 */

/** One exercise in one completed session, reduced to what progress needs. */
export interface ExercisePoint {
  sessionId: string;
  date: ISODate;
  startedAt: number;
  exerciseId: string;
  name: string;
  muscle: string;
  /** Heaviest completed set (net kg). 0 = bodyweight. */
  topWeight: number;
  /** Reps of each completed set at `topWeight`, in set order. */
  topReps: number[];
  targetRepsMin: number;
  targetRepsMax: number;
  targetSets: number;
  volume: number;
  /**
   * The progress measure. Loaded lifts: the mean Epley estimate across the
   * sets at the top weight — so 10/10/9 beats 10/10/8 at the same weight, and
   * a weight jump that costs a couple of reps reads as roughly level, which is
   * exactly how double progression should look. Bodyweight: mean reps.
   */
  measure: number;
  kind: 'load' | 'reps';
}

export function pointFromSets(
  session: Pick<Session, 'id' | 'date' | 'startedAt'>,
  log: Pick<
    ExerciseLog,
    'exerciseId' | 'exerciseName' | 'muscleGroupName' | 'targetRepsMin' | 'targetRepsMax' | 'targetSets'
  >,
  sets: Pick<SetLog, 'weight' | 'reps' | 'completed' | 'setNumber'>[],
): ExercisePoint | null {
  const done = sets
    .filter((s) => s.completed && s.reps > 0)
    .sort((a, b) => a.setNumber - b.setNumber);
  if (done.length === 0) return null;
  const top = done.reduce((m, s) => Math.max(m, s.weight), 0);
  const atTop = done.filter((s) => s.weight === top);
  const topReps = atTop.map((s) => s.reps);
  const kind: ExercisePoint['kind'] = top > 0 ? 'load' : 'reps';
  const measure =
    kind === 'load'
      ? mean(atTop.map((s) => epley1RM(s.weight, s.reps)))
      : mean(topReps);
  return {
    sessionId: session.id,
    date: session.date,
    startedAt: session.startedAt ?? 0,
    exerciseId: log.exerciseId,
    name: log.exerciseName,
    muscle: log.muscleGroupName,
    topWeight: top,
    topReps,
    targetRepsMin: log.targetRepsMin,
    targetRepsMax: log.targetRepsMax,
    targetSets: log.targetSets,
    volume: done.reduce((s, x) => s + x.weight * x.reps, 0),
    measure,
    kind,
  };
}

/**
 * Group every completed session's exercise logs into per-exercise histories,
 * oldest → newest. Logs whose exercise was later deleted are kept: the
 * snapshot fields carry their name, so their history still counts.
 */
export function buildExerciseHistories(
  sessions: Session[],
  logs: ExerciseLog[],
  sets: SetLog[],
): Map<string, ExercisePoint[]> {
  const sessById = new Map(
    sessions.filter((s) => s.status === 'completed').map((s) => [s.id, s]),
  );
  const setsByLog = new Map<string, SetLog[]>();
  for (const s of sets) {
    const arr = setsByLog.get(s.exerciseLogId);
    if (arr) arr.push(s);
    else setsByLog.set(s.exerciseLogId, [s]);
  }
  const out = new Map<string, ExercisePoint[]>();
  for (const log of logs) {
    const sess = sessById.get(log.sessionId);
    if (!sess) continue;
    const p = pointFromSets(sess, log, setsByLog.get(log.id) ?? []);
    if (!p) continue;
    const arr = out.get(p.exerciseId);
    if (arr) arr.push(p);
    else out.set(p.exerciseId, [p]);
  }
  for (const arr of out.values()) arr.sort(byTime);
  return out;
}

/**
 * Ratio between two points of the same exercise, or null when they can't be
 * compared (bodyweight vs loaded). Clamped so one mistyped set can't move the
 * index by more than ±20 %.
 */
export function pointRatio(prev: ExercisePoint, cur: ExercisePoint): number | null {
  if (prev.kind !== cur.kind || prev.measure <= 0 || cur.measure <= 0) return null;
  return Math.min(1.2, Math.max(0.8, cur.measure / prev.measure));
}

export interface IndexPoint {
  sessionId: string;
  date: ISODate;
  /** Strength index within the window. The window's baseline is 100. */
  index: number;
  /** This session's change vs each exercise's previous outing, in %. Null if nothing was comparable. */
  changePct: number | null;
  /** Exercises in this session that had a previous outing to compare with. */
  compared: number;
}

/**
 * Per-session change: the geometric mean of (this outing ÷ previous outing)
 * across the exercises performed in that session. Keyed by session id.
 */
export function sessionChanges(
  histories: Map<string, ExercisePoint[]>,
): Map<string, { changePct: number; compared: number }> {
  const ratiosBySession = new Map<string, number[]>();
  for (const pts of histories.values()) {
    for (let i = 1; i < pts.length; i++) {
      const r = pointRatio(pts[i - 1]!, pts[i]!);
      if (r === null) continue;
      const arr = ratiosBySession.get(pts[i]!.sessionId);
      if (arr) arr.push(r);
      else ratiosBySession.set(pts[i]!.sessionId, [r]);
    }
  }
  const out = new Map<string, { changePct: number; compared: number }>();
  for (const [id, rs] of ratiosBySession) {
    out.set(id, { changePct: round1((geoMean(rs) - 1) * 100), compared: rs.length });
  }
  return out;
}

/**
 * The strength index over a window.
 *
 * The set of exercises is fixed for the window: every exercise trained in it.
 * Each one has a baseline (its last outing before the window, else its first
 * inside it) and, at any session, a current value (its latest outing so far).
 * The index is the geometric mean of current ÷ baseline across all of them.
 *
 * An exercise that is skipped simply keeps its last value, and one that is new
 * starts level, so missing a lift can't make the line jump — the swing the
 * 0–100 score shows. Because every exercise telescopes from its own baseline,
 * the end of the line equals the typical per-exercise change for the window.
 */
export function strengthIndex(
  histories: Map<string, ExercisePoint[]>,
  sessions: Session[],
  since: ISODate | null = null,
): IndexPoint[] {
  const ordered = sessions
    .filter((s) => s.status === 'completed' && (!since || s.date >= since))
    .slice()
    .sort((a, b) =>
      a.date !== b.date ? (a.date < b.date ? -1 : 1) : (a.startedAt ?? 0) - (b.startedAt ?? 0),
    );
  if (ordered.length === 0) return [];

  interface Track {
    base: ExercisePoint;
    pending: ExercisePoint[]; // outings inside the window, oldest first
    ratio: number; // current ÷ base
  }
  const tracks: Track[] = [];
  for (const pts of histories.values()) {
    const inWindow = since ? pts.filter((p) => p.date >= since) : pts;
    if (inWindow.length === 0) continue;
    const before = since ? pts.filter((p) => p.date < since) : [];
    const base = before.length > 0 ? before[before.length - 1]! : inWindow[0]!;
    tracks.push({ base, pending: inWindow.slice(), ratio: 1 });
  }
  if (tracks.length === 0) return [];

  const bySession = new Map<string, Track[]>();
  for (const t of tracks) {
    for (const p of t.pending) {
      const arr = bySession.get(p.sessionId);
      if (arr) arr.push(t);
      else bySession.set(p.sessionId, [t]);
    }
  }
  const changes = sessionChanges(histories);

  const out: IndexPoint[] = [];
  for (const s of ordered) {
    for (const t of bySession.get(s.id) ?? []) {
      const p = t.pending.find((x) => x.sessionId === s.id);
      if (!p || p === t.base) continue;
      const r = t.base.kind === p.kind && t.base.measure > 0 && p.measure > 0
        ? p.measure / t.base.measure
        : 1;
      // One mistyped set can't double or halve the whole line.
      t.ratio = Math.min(2, Math.max(0.5, r));
    }
    const c = changes.get(s.id);
    out.push({
      sessionId: s.id,
      date: s.date,
      index: round1(100 * geoMean(tracks.map((t) => t.ratio))),
      changePct: c?.changePct ?? null,
      compared: c?.compared ?? 0,
    });
  }
  return out;
}

/** The index's change across its window, in % (the line starts at 100). */
export function indexChange(series: IndexPoint[]): number | null {
  if (series.length === 0) return null;
  return round1(series[series.length - 1]!.index - 100);
}

export type TrendStatus = 'up' | 'flat' | 'down' | 'new';

export interface ExerciseTrend {
  exerciseId: string;
  name: string;
  muscle: string;
  points: ExercisePoint[];
  latest: ExercisePoint;
  /** % change of the measure across the window. Null when nothing to compare. */
  changePct: number | null;
  status: TrendStatus;
  /**
   * Reps still missing before the next weight increase: Σ over the target
   * sets of (top of range − reps done at the top weight). 0 = earned it.
   * Null for bodyweight lifts or when the range is unknown.
   */
  repsToIncrease: number | null;
  /** Outings within the window. */
  sessionsInWindow: number;
}

/** ±1.5 % is noise on a single lift, not a trend. */
const FLAT_BAND = 1.5;

export function exerciseTrends(
  histories: Map<string, ExercisePoint[]>,
  since: ISODate | null,
): ExerciseTrend[] {
  const out: ExerciseTrend[] = [];
  for (const [exerciseId, pts] of histories) {
    const inWindow = since ? pts.filter((p) => p.date >= since) : pts;
    if (inWindow.length === 0) continue;
    const latest = pts[pts.length - 1]!;
    // Baseline: the last outing before the window, else the first inside it.
    const before = since ? pts.filter((p) => p.date < since) : [];
    const base = before.length > 0 ? before[before.length - 1]! : inWindow[0]!;
    let changePct: number | null = null;
    if (base !== latest && base.kind === latest.kind && base.measure > 0) {
      changePct = round1((latest.measure / base.measure - 1) * 100);
    }
    const status: TrendStatus =
      changePct === null
        ? 'new'
        : changePct > FLAT_BAND
          ? 'up'
          : changePct < -FLAT_BAND
            ? 'down'
            : 'flat';
    out.push({
      exerciseId,
      name: latest.name,
      muscle: latest.muscle,
      points: pts,
      latest,
      changePct,
      status,
      repsToIncrease: repsToIncrease(latest),
      sessionsInWindow: inWindow.length,
    });
  }
  // Most recently trained first: that's the list the user is acting on.
  return out.sort((a, b) => byTime(b.latest, a.latest));
}

export function repsToIncrease(p: ExercisePoint): number | null {
  if (p.kind !== 'load' || p.targetRepsMax <= 0 || p.targetSets <= 0) return null;
  let missing = 0;
  for (let i = 0; i < p.targetSets; i++) {
    const r = p.topReps[i] ?? 0;
    missing += Math.max(0, p.targetRepsMax - r);
  }
  return missing;
}

/** "62.5 × 10/10/9" — or "גוף × 12/10" for bodyweight. */
export function formatTopSets(p: ExercisePoint): string {
  const w = p.topWeight > 0 ? formatKg(p.topWeight) : 'משקל גוף';
  return `${w} × ${p.topReps.join('/')}`;
}

export function formatKg(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(n * 10 === Math.round(n * 10) ? 1 : 2);
}

// ─── AI analysis prompt ─────────────────────────────────────────────────────

export interface PromptOptions {
  today: ISODate;
  /** Only sessions on or after this date are listed in detail. */
  since: ISODate;
  /** At most this many outings per exercise. */
  perExercise?: number;
}

/**
 * A self-contained Hebrew brief for an AI coach. Plain text so it survives any
 * share target. Only training numbers go in — no names, no body measurements —
 * and nothing leaves the device unless the user picks a destination.
 */
export function buildAnalysisPrompt(
  histories: Map<string, ExercisePoint[]>,
  series: IndexPoint[],
  opts: PromptOptions,
): string {
  const perEx = opts.perExercise ?? 8;
  const trends = exerciseTrends(histories, opts.since).filter((t) => t.sessionsInWindow > 0);
  const sessionsInWindow = series.filter((p) => p.date >= opts.since).length;
  const idx = indexChange(series);

  const lines: string[] = [];
  lines.push('אתה מאמן כוח. נתח את נתוני האימונים שלי וענה בעברית.');
  lines.push('');
  lines.push('איך אני מתאמן:');
  lines.push('- מה שחשוב לי: משקל × חזרות בכל תרגיל. כמה שיותר משקל בכמה שיותר חזרות.');
  lines.push('- התקדמות כפולה: מעלה חזרות במשקל קבוע עד שכל הסטים מגיעים לראש הטווח, ואז מעלה משקל.');
  lines.push('- כל המשקלים נטו (בלי משקל המוט).');
  lines.push('');
  lines.push(`תקופה: ${opts.since} עד ${opts.today} · ${sessionsInWindow} אימונים.`);
  if (idx !== null) {
    lines.push(
      `מדד כוח כולל (כל תרגיל מול עצמו, ממוצע גיאומטרי): ${idx > 0 ? '+' : ''}${idx}% בתקופה.`,
    );
  }
  lines.push('');
  lines.push('פורמט: תאריך: משקל × חזרות בכל סט במשקל העליון. [טווח יעד].');
  lines.push('');
  for (const t of trends) {
    const p = t.latest;
    const range = p.targetRepsMax > 0 ? ` [${p.targetSets}×${p.targetRepsMin}–${p.targetRepsMax}]` : '';
    const change = t.changePct === null ? '' : ` · שינוי ${t.changePct > 0 ? '+' : ''}${t.changePct}%`;
    lines.push(`${t.name} (${t.muscle})${range}${change}`);
    for (const pt of t.points.filter((x) => x.date >= opts.since).slice(-perEx)) {
      lines.push(`  ${pt.date}: ${formatTopSets(pt)}`);
    }
  }
  lines.push('');
  lines.push('אני מבקש:');
  lines.push('1. סיכום קצר: איפה אני מתקדם, איפה תקוע, ואיפה יורד.');
  lines.push('2. לכל תרגיל תקוע: מה לעשות באימון הבא (משקל וחזרות), ולמה.');
  lines.push('3. דפוסים כלליים (נפח, תדירות, איזון בין קבוצות שריר) ששווה לשים לב אליהם.');
  lines.push('4. שלוש פעולות מעשיות לשבועיים הקרובים.');
  return lines.join('\n');
}

// ─── helpers ────────────────────────────────────────────────────────────────

function byTime(a: ExercisePoint, b: ExercisePoint): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return a.startedAt - b.startedAt;
}

function geoMean(xs: number[]): number {
  return xs.length === 0 ? 1 : Math.exp(xs.reduce((s, x) => s + Math.log(x), 0) / xs.length);
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

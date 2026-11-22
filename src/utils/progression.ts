import type { Exercise, PlatePair, SetLog } from '@/types';
import { smallestPairIncrement } from './plateMath';

/**
 * Double progression, set by set.
 *
 *  - Hold the working weight and ask for ONE more rep on every set that is not
 *    yet at the top of the range. Each set keeps its own target: 10,10,8 last
 *    time becomes 10,10,9 — never 8,8,8, and never a jump to the top of the
 *    range from 3–4 reps.
 *  - When every target set reached the top of the range, add one increment.
 *    The new rep target is what Epley says the lifter can do at the new weight,
 *    kept inside the range — not a blind reset to the bottom.
 *  - Stuck (3 sessions at the same weight with no extra reps):
 *      · within 1 rep of the top on every set → "break": add weight, fewer reps.
 *      · still inside the range → step back ONE increment, keep chasing reps.
 *      · not one set inside the range → ~10% deload, bottom of the range.
 *    A lift one rep short of earning its increase is never deloaded.
 *
 * RPE is deliberately not an input: the owner rarely logs it.
 */
export type ProgressionKind = 'first' | 'increase' | 'break' | 'add-rep' | 'hold' | 'deload';

export interface Prescription {
  /** Net weight to load (kg). */
  weight: number;
  /**
   * Target reps per set, in set order (length = targetSets). Optional only
   * because drafts autosaved before per-set targets existed lack it — read it
   * through `targetRepsForSet`.
   */
  setReps?: number[];
  /** Headline rep target: the highest of `setReps`. */
  reps: number;
  kind: ProgressionKind;
  /** Working weight this is measured against (last session's). */
  fromWeight: number;
}

/**
 * Smallest weight step this exercise can actually be loaded with.
 *  - explicit per-exercise override wins (machine stacks jump in 5 kg, cables in 2.5)
 *  - machines fall back to 2.5 kg
 *  - barbells fall back to the smallest OWNED plate pair (2 × plate)
 */
export function resolveIncrement(args: {
  incrementKg?: number;
  isMachine?: boolean;
  inventory: PlatePair[];
}): number {
  const { incrementKg, isMachine, inventory } = args;
  if (incrementKg !== undefined && incrementKg > 0) return incrementKg;
  if (isMachine) return 2.5;
  return smallestPairIncrement(inventory);
}

/** The sets from one past session, as needed for progression. */
export interface PastSet {
  weight: number;
  reps: number;
  completed: boolean;
}

export function pastSetsFromLogs(logs: SetLog[]): PastSet[] {
  return logs.map((s) => ({ weight: s.weight, reps: s.reps, completed: s.completed }));
}

/** Round to a clean multiple of the increment, avoiding 42.50000000000001. */
function snap(weight: number, increment: number): number {
  if (increment <= 0) return round2(weight);
  return round2(Math.round(weight / increment) * increment);
}

function snapDown(weight: number, increment: number): number {
  if (increment <= 0) return round2(weight);
  return round2(Math.floor(weight / increment + 1e-9) * increment);
}

function snapUp(weight: number, increment: number): number {
  if (increment <= 0) return round2(weight);
  return round2(Math.ceil(weight / increment - 1e-9) * increment);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const same = (a: number, b: number): boolean => Math.abs(a - b) < 0.001;

const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ''));

/** How many sessions at one weight without a rep gain count as "stuck". */
export const STUCK_SESSIONS = 3;

/**
 * Reps to aim for at `toWeight` after `reps` at `fromWeight`: Epley's estimate
 * minus one. Replaying the owner's history, raw Epley overshot his first
 * session at a new weight by about a rep (52.5×8 → 55 predicted 6, he got 5);
 * a first target he misses is worse than one he beats.
 */
function repsAt(fromWeight: number, reps: number, toWeight: number): number {
  if (toWeight <= 0) return reps;
  const e1rm = fromWeight * (1 + reps / 30);
  return Math.floor(30 * (e1rm / toWeight - 1) + 1e-9) - 1;
}

/**
 * The weight a session was actually trained at.
 *
 * The heaviest weight with at least one set inside the rep range. A single
 * grinder above it (22×3, then 18×6,6,5 in a 6–10 range) was an attempt, not
 * the working weight — prescribing more sets at 22 is how the old engine
 * pushed 3-rep sets toward 10. If nothing reached the range, the weight with
 * the most sets (heavier on a tie). Warm-ups below are ignored either way.
 */
export function workingWeight(done: PastSet[], repsMin: number): number {
  const inRange = done.filter((s) => s.reps >= repsMin);
  if (inRange.length > 0) return Math.max(...inRange.map((s) => s.weight));
  const counts = new Map<number, number>();
  for (const s of done) counts.set(s.weight, (counts.get(s.weight) ?? 0) + 1);
  let best = done[0]!.weight;
  let bestCount = 0;
  for (const [w, c] of counts) {
    if (c > bestCount || (c === bestCount && w > best)) {
      best = w;
      bestCount = c;
    }
  }
  return best;
}

interface SessionRead {
  weight: number;
  /** Reps per target set at the working weight, padded to `targetSets`. */
  reps: number[];
  /** Sets actually performed at the working weight (before padding). */
  setsAtWeight: number;
  total: number;
}

function readSession(sets: PastSet[], targetSets: number, repsMin: number): SessionRead | null {
  const done = sets.filter((s) => s.completed && s.reps > 0);
  if (done.length === 0) return null;
  const weight = workingWeight(done, repsMin);
  const atW = done.filter((s) => same(s.weight, weight)).map((s) => s.reps);
  const n = Math.max(1, targetSets);
  // Sets done lighter (or skipped) are assumed to match the weakest set at the
  // working weight — the honest guess, and it never inflates a target.
  const pad = Math.min(...atW);
  const reps = Array.from({ length: n }, (_, i) => atW[i] ?? pad);
  return { weight, reps, setsAtWeight: atW.length, total: reps.reduce((a, b) => a + b, 0) };
}

/**
 * What to lift today for one exercise.
 *
 * `history` holds the sets of this exercise's recent sessions, oldest → newest;
 * the last entry is the session to progress from. Only the last few matter.
 */
export function prescribe(args: {
  history: PastSet[][];
  targetSets: number;
  repsMin: number;
  repsMax: number;
  increment: number;
  seedWeight?: number;
}): Prescription {
  const { history, targetSets, repsMin, repsMax, increment, seedWeight } = args;
  const n = Math.max(1, targetSets);
  const flat = (reps: number): number[] => Array.from({ length: n }, () => reps);
  const make = (kind: ProgressionKind, weight: number, setReps: number[], fromWeight: number): Prescription => ({
    kind,
    weight,
    setReps,
    reps: Math.max(...setReps),
    fromWeight,
  });

  const reads = history
    .map((s) => readSession(s, n, repsMin))
    .filter((r): r is SessionRead => r !== null);
  const last = reads[reads.length - 1];

  if (!last) {
    const weight = seedWeight !== undefined && seedWeight > 0 ? snap(seedWeight, increment) : 0;
    return make('first', weight, flat(repsMin), 0);
  }

  const W = last.weight;
  // One more rep on every set below the top. A set already at or past the top
  // keeps what it did — a target must never ask for fewer reps than last time.
  const addOne = last.reps.map((r) => (r >= repsMax ? r : r + 1));
  const weakest = Math.min(...last.reps);

  // Bodyweight / unweighted work: never invent load. Chase reps only.
  if (W <= 0) {
    const atTop = weakest >= repsMax && last.setsAtWeight >= n;
    return make(atTop ? 'hold' : 'add-rep', 0, addOne, 0);
  }

  const heavier = snap(W + increment, increment);
  const repsAfterIncrease = (): number[] => {
    const r = repsAt(W, weakest, heavier);
    const hi = Math.max(repsMin, repsMax - 1);
    return flat(Math.min(hi, Math.max(repsMin, r)));
  };

  if (last.setsAtWeight >= n && weakest >= repsMax) {
    return make('increase', heavier, repsAfterIncrease(), W);
  }

  // Stuck: the last STUCK_SESSIONS sessions were all at this weight and none
  // of the later ones beat the first on total reps. Any gain inside the window
  // means it is still moving — one bad day after a good one is not a plateau.
  // A session with only one or two sets at the weight (a single heavy top
  // set after lighter work) is padded to a full session and would make a
  // baseline nothing can beat, so such sessions never count toward "stuck".
  const recent = reads.slice(-STUCK_SESSIONS);
  const solid = (r: SessionRead): boolean => r.setsAtWeight >= Math.ceil(n / 2);
  const stuck =
    recent.length === STUCK_SESSIONS &&
    recent.every((r) => same(r.weight, W) && solid(r)) &&
    recent.slice(1).every((r) => r.total <= recent[0]!.total);

  if (stuck) {
    if (weakest >= repsMax - 1) {
      // One rep short for several sessions: the owner's own rule is to go
      // heavier and drop the reps rather than grind the same weight again.
      return make('break', heavier, repsAfterIncrease(), W);
    }
    if (Math.max(...last.reps) >= repsMin) {
      // Inside the range but not climbing: one increment back, same per-set
      // chase. Small enough that the next increase puts him straight back.
      // Nearest loadable weight at most one step down: 8 kg dumbbells on a
      // 2.5 grid go to 7.5, not to 5.
      const lighter = snapUp(W - increment, increment);
      if (lighter > 0 && lighter < W) return make('deload', lighter, addOne, W);
    } else {
      // Not one set reached the range: the weight is simply too heavy.
      const lighter = snapDown(W * 0.9, increment);
      if (lighter > 0 && lighter < W) return make('deload', lighter, flat(repsMin), W);
    }
  }

  // Every set already at the top but some sets missing: finish them first.
  const nothingToAdd = addOne.every((r, i) => r === last.reps[i]);
  return make(nothingToAdd ? 'hold' : 'add-rep', W, addOne, W);
}

/** Target reps for set `index` (0-based). Extra sets repeat the last target. */
export function targetRepsForSet(p: Prescription, index: number): number {
  const list = p.setReps;
  if (!list || list.length === 0) return p.reps;
  return list[Math.min(index, list.length - 1)]!;
}

/** "10,10,9" or just "8" when every set shares the target. */
export function formatSetReps(p: Prescription): string {
  const list = p.setReps && p.setReps.length > 0 ? p.setReps : [p.reps];
  return list.every((r) => r === list[0]) ? String(list[0]) : list.join(',');
}

/**
 * Today's prescription for a plan exercise. The single entry point the logger,
 * the dashboard stall card and the exercise page all share, so the coach and
 * the warnings can never disagree about whether to deload.
 */
export function prescriptionForExercise(
  ex: Pick<Exercise, 'targetSets' | 'targetRepsMin' | 'targetRepsMax' | 'incrementKg' | 'isMachine' | 'seedWeight'>,
  history: PastSet[][],
  inventory: PlatePair[],
): Prescription {
  const increment = resolveIncrement({
    ...(ex.incrementKg !== undefined ? { incrementKg: ex.incrementKg } : {}),
    ...(ex.isMachine ? { isMachine: true } : {}),
    inventory,
  });
  return prescribe({
    history: history.slice(-STUCK_SESSIONS),
    targetSets: ex.targetSets,
    repsMin: ex.targetRepsMin,
    repsMax: ex.targetRepsMax,
    increment,
    ...(ex.seedWeight !== undefined ? { seedWeight: ex.seedWeight } : {}),
  });
}

/** "45 → 42.5 kg (–6%)" for a deload prescription; null for anything else. */
export function deloadOf(p: Prescription): { fromKg: number; toKg: number; pct: number } | null {
  if (p.kind !== 'deload' || p.fromWeight <= 0 || p.weight >= p.fromWeight) return null;
  return {
    fromKg: p.fromWeight,
    toKg: p.weight,
    pct: Math.round(((p.fromWeight - p.weight) / p.fromWeight) * 100),
  };
}

/** "40×8,8,7" — compact recap of last session, shown next to the prescription. */
export function formatLastSets(lastSets: PastSet[]): string {
  const done = lastSets.filter((s) => s.completed && s.reps > 0);
  if (done.length === 0) return '';
  const byWeight = new Map<number, number[]>();
  for (const s of done) {
    const arr = byWeight.get(s.weight) ?? [];
    arr.push(s.reps);
    byWeight.set(s.weight, arr);
  }
  return [...byWeight.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([w, reps]) => `${fmt(w)}×${reps.join(',')}`)
    .join(' · ');
}

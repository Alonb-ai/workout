import type { PlatePair, SetLog } from '@/types';
import { smallestPairIncrement } from './plateMath';
import { deloadWeight } from './stall';

/**
 * Double progression: hold the weight until every target set is completed at the
 * TOP of the rep range, then add one increment and drop back to the bottom of
 * the range. This is the whole progression model — RPE, velocity and % of 1RM
 * schemes need more data than a single user logging 3 sets will ever provide.
 */
export type ProgressionKind = 'first' | 'increase' | 'add-rep' | 'hold' | 'deload';

export interface Prescription {
  /** Net weight to load (kg). */
  weight: number;
  /** Target reps for every set. */
  reps: number;
  kind: ProgressionKind;
  /** Weight this is measured against (last session's top weight). */
  fromWeight: number;
}
// ponytail: no `label` string here. The UI renders the numbers themselves plus a
// word for the kind (see PrescriptionStrip); a pre-baked Hebrew sentence was one
// more thing to keep in sync and impossible to lay out well.

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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ''));

/**
 * What to lift today for one exercise.
 *
 * `lastSets` are the sets logged in the most recent completed session of this
 * exercise (any order). `isStalled` comes from the existing 3-session stall
 * detector — a stall outranks "hold", because holding is what caused it.
 */
export function prescribe(args: {
  lastSets: PastSet[];
  targetSets: number;
  repsMin: number;
  repsMax: number;
  increment: number;
  isStalled?: boolean;
  seedWeight?: number;
}): Prescription {
  const { lastSets, targetSets, repsMin, repsMax, increment, isStalled, seedWeight } = args;

  const done = lastSets.filter((s) => s.completed && s.reps > 0);
  if (done.length === 0) {
    const weight = seedWeight !== undefined && seedWeight > 0 ? snap(seedWeight, increment) : 0;
    return {
      weight,
      reps: repsMin,
      kind: 'first',
      fromWeight: 0,
    };
  }

  const top = Math.max(...done.map((s) => s.weight));
  const atTop = done.filter((s) => s.weight >= top - 0.001);
  // Conservative: the WEAKEST set at the top weight decides. Hitting the top of
  // the range on set 1 and failing on set 3 has not earned an increase.
  const minRepsAtTop = Math.min(...atTop.map((s) => s.reps));

  // Bodyweight / unweighted work is checked FIRST: 0 kg + increment would
  // silently prescribe "load 2.5 kg" for push-ups. Chase reps instead and let
  // the user type a belt weight himself if he wants one.
  if (top <= 0) {
    const reps = Math.min(repsMax, minRepsAtTop + 1);
    const atMax = minRepsAtTop >= repsMax && atTop.length >= targetSets;
    return {
      weight: 0,
      reps,
      kind: atMax ? 'hold' : 'add-rep',
      fromWeight: 0,
    };
  }

  const earnedIncrease = atTop.length >= targetSets && minRepsAtTop >= repsMax;
  if (earnedIncrease) {
    const weight = snap(top + increment, increment);
    return {
      weight,
      reps: repsMin,
      kind: 'increase',
      fromWeight: top,
    };
  }

  if (isStalled) {
    const weight = deloadWeight(top, increment);
    if (weight > 0 && weight < top) {
      return {
        weight,
        reps: repsMin,
        kind: 'deload',
        fromWeight: top,
      };
    }
  }

  if (atTop.length < targetSets) {
    return {
      weight: top,
      reps: repsMax,
      kind: 'hold',
      fromWeight: top,
    };
  }

  const reps = Math.min(repsMax, minRepsAtTop + 1);
  return {
    weight: top,
    reps,
    kind: 'add-rep',
    fromWeight: top,
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

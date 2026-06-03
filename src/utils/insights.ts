import type { Exercise, ExerciseSessionStats } from '@/types';
import { deloadWeight } from './stall';

/**
 * Progression rate over the available history. Uses simple end-to-end math
 * rather than full linear regression — with sparse weekly/bi-weekly data the
 * extra rigor isn't worth the complexity. Sample size is exposed so the UI
 * can downplay the number when the history is short.
 *
 * Returns null when fewer than 2 sessions exist or when the span is shorter
 * than a few days (rate would be noisy).
 */
export interface ProgressionRate {
  /** Change in topWeight per 30 days. */
  kgPerMonth: number;
  /** Same, but as a percent of the starting topWeight. */
  pctPerMonth: number;
  /** Number of sessions the calculation considered. */
  sampleSize: number;
  /** Time span covered in days. */
  spanDays: number;
}

export function computeProgressionRate(
  stats: ExerciseSessionStats[],
): ProgressionRate | null {
  if (stats.length < 2) return null;
  const first = stats[0]!;
  const last = stats[stats.length - 1]!;
  if (first.topWeight <= 0) return null;
  const spanDays = daysBetween(first.date, last.date);
  if (spanDays < 4) return null;
  const dKg = last.topWeight - first.topWeight;
  const kgPerMonth = (dKg / spanDays) * 30;
  const pctPerMonth = (kgPerMonth / first.topWeight) * 100;
  return {
    kgPerMonth: round1(kgPerMonth),
    pctPerMonth: round1(pctPerMonth),
    sampleSize: stats.length,
    spanDays,
  };
}

/**
 * Concrete deload suggestion: drop to ~90% of the recent top weight, rounded
 * to the smallest available plate increment. Returns the from/to pair so the
 * UI can show "100 → 90 kg" instead of just a percentage. Returns null if the
 * history is too short to suggest with any confidence.
 */
export interface DeloadSuggestion {
  fromKg: number;
  toKg: number;
  pct: number;
}

export function suggestDeload(
  stats: ExerciseSessionStats[],
  smallestIncrement = 2.5,
): DeloadSuggestion | null {
  if (stats.length < 3) return null;
  const recent = stats.slice(-3);
  const fromKg = Math.max(...recent.map((s) => s.topWeight));
  if (fromKg <= 0) return null;
  const toKg = deloadWeight(fromKg, smallestIncrement);
  if (toKg >= fromKg) return null;
  return {
    fromKg,
    toKg,
    pct: Math.round(((fromKg - toKg) / fromKg) * 100),
  };
}

/**
 * Other exercises in the same muscle group, excluding the source exercise.
 * Used to suggest swaps for a stalled lift. Plain "same group" matching —
 * any cross-group overlap (e.g. close-grip bench → triceps too) is not
 * modeled, so this stays a hint, not a recommendation engine.
 */
export function findSubstitutes(
  exerciseId: string,
  allExercises: Exercise[],
  limit = 3,
): Exercise[] {
  const src = allExercises.find((e) => e.id === exerciseId);
  if (!src) return [];
  return allExercises
    .filter((e) => e.id !== exerciseId && e.muscleGroupId === src.muscleGroupId)
    .slice(0, limit);
}

function daysBetween(aIso: string, bIso: string): number {
  const a = new Date(aIso + 'T00:00:00').getTime();
  const b = new Date(bIso + 'T00:00:00').getTime();
  return Math.max(0, Math.round((b - a) / (24 * 3600 * 1000)));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

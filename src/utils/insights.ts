import type { Exercise, ExerciseSessionStats } from '@/types';
import { deloadWeight } from './stall';
import { rankSimilar, sameExerciseName } from './exerciseCatalog';

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
 * Exercises that train the same muscles, best match first — used to suggest a
 * swap for a stalled lift. Muscles are inferred from the name and the muscle
 * group label (see `utils/exerciseCatalog.ts`), so a close-grip bench under
 * "חזה" still matches the triceps work under "יד אחורית". Archived exercises
 * qualify (they have history to resume); ones folded into another do not.
 */
export function findSubstitutes(
  exerciseId: string,
  allExercises: Exercise[],
  limit = 3,
  groupNameById: Map<string, string> = new Map(),
): Exercise[] {
  const src = allExercises.find((e) => e.id === exerciseId);
  if (!src) return [];
  const describe = (e: Exercise) => ({
    name: e.name,
    ...(e.muscles ? { muscles: e.muscles } : {}),
    ...(e.isMachine ? { isMachine: true } : {}),
    groupName: groupNameById.get(e.muscleGroupId) ?? e.archivedFrom?.groupName ?? '',
  });
  const pool = allExercises.filter(
    (e) => e.id !== exerciseId && e.mergedInto === undefined && !sameExerciseName(e.name, src.name),
  );
  // Same muscle group always qualifies, even when neither name says anything
  // the muscle guesser recognises ("Incline Press" under "חזה").
  return rankSimilar(describe(src), pool, describe, 0)
    .map((c) => ({
      ...c,
      score: c.score + (c.item.muscleGroupId === src.muscleGroupId && src.muscleGroupId ? 40 : 0),
    }))
    .filter((c) => c.score >= 30)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((c) => c.item);
}

function daysBetween(aIso: string, bIso: string): number {
  const a = new Date(aIso + 'T00:00:00').getTime();
  const b = new Date(bIso + 'T00:00:00').getTime();
  return Math.max(0, Math.round((b - a) / (24 * 3600 * 1000)));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

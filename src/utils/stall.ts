import type { ExerciseSessionStats, StallFlag } from '@/types';

/**
 * Stall detection:
 *   An exercise is "stalled" if its last 3 sessions (in chronological order)
 *   show NO improvement in either top weight OR total volume.
 *   Concretely: max(topWeight) across the 3 == topWeight of session 1 of the 3
 *   AND same for volume.
 *
 *   Equivalently: sessions 2 and 3 do not exceed session 1 in either metric.
 *
 * Returns null if fewer than 3 sessions exist.
 */
export function detectStall(
  stats: ExerciseSessionStats[], // sorted oldest → newest
  exerciseName: string,
): StallFlag | null {
  if (stats.length < 3) return null;
  const lastThree = stats.slice(-3);
  const baseline = lastThree[0]!;
  const everImprovedTop = lastThree
    .slice(1)
    .some((s) => s.topWeight > baseline.topWeight + 0.01);
  const everImprovedVol = lastThree
    .slice(1)
    .some((s) => s.volume > baseline.volume + 0.5);

  if (everImprovedTop || everImprovedVol) return null;

  return {
    exerciseId: baseline.exerciseId,
    exerciseName,
    lastThreeSessionIds: lastThree.map((s) => s.sessionId),
    topWeight: lastThree[lastThree.length - 1]!.topWeight,
    reason: 'אין שיפור בנפח או במשקל המקסימלי ב-3 האימונים האחרונים.',
  };
}

/**
 * Deload suggestion: reduce ~10% of top weight, rounded to the smallest available pair increment.
 */
export function deloadWeight(topWeight: number, smallestIncrement = 2.5): number {
  if (topWeight <= 0) return 0;
  const target = topWeight * 0.9;
  return Math.max(
    smallestIncrement,
    Math.round(target / smallestIncrement) * smallestIncrement,
  );
}

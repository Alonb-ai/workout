import type {
  SetLog,
  ExerciseLog,
  Session,
  ExerciseSessionStats,
  ComparisonTag,
  WorkoutScore,
} from '@/types';

/** Epley estimated 1RM. Returns 0 if reps<=0 or weight<=0. */
export function epley1RM(weight: number, reps: number): number {
  if (weight <= 0 || reps <= 0) return 0;
  return weight * (1 + reps / 30);
}

/** Best estimated 1RM across completed sets. */
export function bestEst1RM(sets: SetLog[]): number {
  return sets.reduce(
    (max, s) => (s.completed ? Math.max(max, epley1RM(s.weight, s.reps)) : max),
    0,
  );
}

/** Volume = sum(weight*reps) for completed sets. */
export function totalVolume(sets: SetLog[]): number {
  return sets.reduce(
    (sum, s) => (s.completed ? sum + s.weight * s.reps : sum),
    0,
  );
}

export function topWeight(sets: SetLog[]): number {
  return sets.reduce(
    (max, s) => (s.completed ? Math.max(max, s.weight) : max),
    0,
  );
}

export function statsForExercise(
  sessionId: string,
  exerciseId: string,
  date: string,
  sets: SetLog[],
  plannedSets: number,
): ExerciseSessionStats {
  const completed = sets.filter((s) => s.completed);
  const tw = topWeight(completed);
  const topRepsForTopWeight = completed
    .filter((s) => s.weight === tw)
    .reduce((m, s) => Math.max(m, s.reps), 0);
  return {
    exerciseId,
    sessionId,
    date,
    topWeight: tw,
    topReps: topRepsForTopWeight,
    volume: totalVolume(completed),
    est1RM: bestEst1RM(completed),
    completedSets: completed.length,
    plannedSets,
  };
}

/** Compare current vs previous session of same exercise. */
export function compareToPrevious(
  current: ExerciseSessionStats,
  previous: ExerciseSessionStats | null,
  allPrevious: ExerciseSessionStats[],
): ComparisonTag {
  if (!previous) {
    return { kind: 'new', label: 'תרגיל חדש' };
  }

  const bestEverTop = Math.max(...allPrevious.map((s) => s.topWeight), 0);
  const bestEver1RM = Math.max(...allPrevious.map((s) => s.est1RM), 0);
  const bestEverVol = Math.max(...allPrevious.map((s) => s.volume), 0);

  const isPR =
    current.topWeight > bestEverTop ||
    current.est1RM > bestEver1RM ||
    current.volume > bestEverVol;

  const deltaVolumePct = previous.volume === 0
    ? 0
    : ((current.volume - previous.volume) / previous.volume) * 100;
  const deltaTopPct = previous.topWeight === 0
    ? 0
    : ((current.topWeight - previous.topWeight) / previous.topWeight) * 100;

  if (isPR) {
    return {
      kind: 'pr',
      label: 'שיא חדש',
      deltaVolumePct,
      deltaTopPct,
    };
  }

  if (deltaVolumePct > 1 || deltaTopPct > 1) {
    return { kind: 'up', label: 'שיפור', deltaVolumePct, deltaTopPct };
  }
  if (deltaVolumePct < -1 || deltaTopPct < -1) {
    return { kind: 'down', label: 'ירידה', deltaVolumePct, deltaTopPct };
  }
  return { kind: 'same', label: 'נשמר', deltaVolumePct, deltaTopPct };
}

/**
 * Workout score (0–100):
 *   - 50%: total volume vs avg of last 3 same-type sessions (current/avg clamped to [0.5,1.5] → mapped 0–100)
 *   - 25%: PR count (0→0, 1→60, 2→85, ≥3→100, scaled)
 *   - 25%: completion rate of planned sets
 */
export function computeWorkoutScore(args: {
  currentVolume: number;
  prevVolumes: number[]; // up to 3
  prCount: number;
  plannedSets: number;
  completedSets: number;
}): WorkoutScore {
  const { currentVolume, prevVolumes, prCount, plannedSets, completedSets } = args;

  const avgPrev = prevVolumes.length
    ? prevVolumes.reduce((a, b) => a + b, 0) / prevVolumes.length
    : 0;

  let volumeComponent: number;
  let deltaPct = 0;
  if (avgPrev === 0) {
    // No prior data: a workout with any completed work scores neutrally at 70 here.
    volumeComponent = currentVolume > 0 ? 70 : 0;
  } else {
    const ratio = currentVolume / avgPrev;
    deltaPct = (ratio - 1) * 100;
    // Map ratio 0.5 → 0, 1.0 → 70, 1.5 → 100 (linear in two segments)
    const clamped = Math.max(0.5, Math.min(1.5, ratio));
    volumeComponent =
      clamped <= 1
        ? ((clamped - 0.5) / 0.5) * 70 // 0..70
        : 70 + ((clamped - 1) / 0.5) * 30; // 70..100
  }

  const prComponent =
    prCount <= 0 ? 0 : prCount === 1 ? 60 : prCount === 2 ? 85 : 100;

  const completionComponent =
    plannedSets <= 0 ? 100 : Math.min(100, (completedSets / plannedSets) * 100);

  const score = Math.round(
    volumeComponent * 0.5 + prComponent * 0.25 + completionComponent * 0.25,
  );

  const deltaLabel = deltaPct >= 0 ? `+${deltaPct.toFixed(0)}%` : `${deltaPct.toFixed(0)}%`;
  const prText =
    prCount === 0
      ? ''
      : prCount === 1
        ? '· שיא חדש 1 💪'
        : `· ${prCount} שיאים חדשים 💪`;
  const message =
    avgPrev === 0
      ? `אימון ראשון מסוגו — נפח ${currentVolume.toLocaleString('he-IL')}kg ${prText}`.trim()
      : `נפח ${deltaLabel} מהממוצע ${prText}`.trim();

  return {
    score: Math.max(0, Math.min(100, score)),
    volume: currentVolume,
    volumeAvgPrev3: avgPrev,
    volumeDeltaPct: deltaPct,
    prCount,
    plannedSets,
    completedSets,
    completionPct: completionComponent,
    message,
  };
}

/** Count PRs across all exercises in a session. */
export function countPRs(tags: ComparisonTag[]): number {
  return tags.filter((t) => t.kind === 'pr').length;
}

export interface ExerciseInSession {
  exerciseLog: ExerciseLog;
  sets: SetLog[];
}

/** Sum volume across exercises in a session. */
export function sessionTotalVolume(exs: ExerciseInSession[]): number {
  return exs.reduce((sum, ex) => sum + totalVolume(ex.sets), 0);
}

export function sessionPlannedSets(exs: ExerciseInSession[]): number {
  return exs.reduce((s, ex) => s + ex.exerciseLog.targetSets, 0);
}

export function sessionCompletedSets(exs: ExerciseInSession[]): number {
  return exs.reduce((s, ex) => s + ex.sets.filter((x) => x.completed).length, 0);
}

/** Sort sessions newest first. */
export function sortSessionsDesc(sessions: Session[]): Session[] {
  return [...sessions].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return (b.startedAt ?? 0) - (a.startedAt ?? 0);
  });
}

import { db, newId, now } from '@/db/db';
import type {
  Workout,
  Exercise,
  MuscleGroup,
  Session,
  SetLog,
  ExerciseLog,
} from '@/types';
import type { DraftExercise } from './types';
import {
  computeWorkoutScore,
  statsForExercise,
  compareToPrevious,
  totalVolume as setsVolume,
} from '@/utils/scoring';
import { getExerciseStatsHistory, getRecentWorkoutSessions } from '@/db/queries';

/** Build an initial draft for the workout by pulling last-session values. */
export async function buildDraftFromWorkout(
  workoutId: string,
): Promise<{ workout: Workout; drafts: DraftExercise[] } | null> {
  const workout = await db.workouts.get(workoutId);
  if (!workout) return null;

  const groups = (
    await db.muscleGroups.where('workoutId').equals(workoutId).toArray()
  ).sort((a, b) => a.order - b.order);
  const groupIds = groups.map((g) => g.id);
  const exercises = (
    await db.exercises.where('muscleGroupId').anyOf(groupIds).toArray()
  ).sort((a, b) => a.order - b.order);

  const drafts: DraftExercise[] = [];
  for (const g of groups) {
    const groupExercises = exercises.filter((e) => e.muscleGroupId === g.id);
    for (const ex of groupExercises) {
      drafts.push(await buildDraftForExercise(ex, g));
    }
  }
  return { workout, drafts };
}

export async function buildDraftForExercise(
  ex: Exercise,
  group: MuscleGroup,
): Promise<DraftExercise> {
  const stats = await getExerciseStatsHistory(ex.id);
  let ghostSets: { weight: number; reps: number }[] = [];
  if (stats.length > 0) {
    const lastSessionId = stats[stats.length - 1]!.sessionId;
    const logs = await db.exerciseLogs.where('sessionId').equals(lastSessionId).toArray();
    const log = logs.find((l) => l.exerciseId === ex.id);
    if (log) {
      const sets = (
        await db.setLogs.where('exerciseLogId').equals(log.id).toArray()
      ).sort((a, b) => a.setNumber - b.setNumber);
      ghostSets = sets.map((s) => ({ weight: s.weight, reps: s.reps }));
    }
  }

  const setCount = Math.max(ghostSets.length, ex.targetSets);
  const sets = Array.from({ length: setCount }, (_, i) => {
    const g = ghostSets[i];
    const useSeed = ex.seedWeight !== undefined && !g && i === 0;
    return {
      setNumber: i + 1,
      weight: '' as number | '',
      reps: '' as number | '',
      completed: false,
      ...(g
        ? { ghostWeight: g.weight, ghostReps: g.reps }
        : useSeed
          ? { ghostWeight: ex.seedWeight as number, ghostReps: ex.targetRepsMin }
          : {}),
    };
  });

  return {
    exerciseId: ex.id,
    exerciseName: ex.name,
    muscleGroupId: group.id,
    muscleGroupName: group.name,
    targetSets: ex.targetSets,
    targetRepsMin: ex.targetRepsMin,
    targetRepsMax: ex.targetRepsMax,
    barWeight: ex.barWeight,
    isMachine: !!ex.isMachine,
    defaultRestSec: ex.defaultRestSec,
    ...(ex.notes ? { notes: ex.notes } : {}),
    ...(ex.seedWeight !== undefined ? { seedWeight: ex.seedWeight } : {}),
    order: ex.order,
    sets,
  };
}

/** Pre-fill all draft sets with the exact weights/reps from the last session. */
export async function applyRepeatLastSession(
  workoutId: string,
  drafts: DraftExercise[],
): Promise<DraftExercise[]> {
  const sessions = await db.sessions.where('workoutId').equals(workoutId).toArray();
  const completed = sessions
    .filter((s) => s.status === 'completed')
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (b.startedAt ?? 0) - (a.startedAt ?? 0);
    });
  const last = completed[0];
  if (!last) return drafts;

  const logs = await db.exerciseLogs.where('sessionId').equals(last.id).toArray();
  const sets = await db.setLogs.where('sessionId').equals(last.id).toArray();
  const setsByExerciseId = new Map<string, SetLog[]>();
  for (const s of sets) {
    const log = logs.find((l) => l.id === s.exerciseLogId);
    if (!log) continue;
    const arr = setsByExerciseId.get(log.exerciseId) ?? [];
    arr.push(s);
    setsByExerciseId.set(log.exerciseId, arr);
  }

  return drafts.map((d) => {
    const prev = setsByExerciseId.get(d.exerciseId);
    if (!prev || prev.length === 0) return d;
    const sorted = [...prev].sort((a, b) => a.setNumber - b.setNumber);
    const newSets = sorted.map((s, i) => ({
      setNumber: i + 1,
      weight: s.weight as number | '',
      reps: s.reps as number | '',
      completed: false,
      ghostWeight: s.weight,
      ghostReps: s.reps,
    }));
    return { ...d, sets: newSets };
  });
}

export interface SaveResult {
  session: Session;
  score: number;
  prCount: number;
  volumeDeltaPct: number;
  message: string;
}

/** Persist a finished session and return the saved Session plus its score. */
export async function saveSession(args: {
  workout: Workout;
  drafts: DraftExercise[];
  date: string;
  startedAt: number;
  notes?: string;
}): Promise<SaveResult> {
  const { workout, drafts, date, startedAt, notes } = args;

  // Compute previous stats per exercise BEFORE the transaction (queries within
  // the same RW transaction can include in-flight writes).
  const perExerciseStats = await Promise.all(
    drafts.map((d) => getExerciseStatsHistory(d.exerciseId)),
  );
  const recentSameWorkout = await getRecentWorkoutSessions(workout.id, 3);
  const prevVolumes = recentSameWorkout.map((s) => s.totalVolume ?? 0);

  const sessionId = newId();
  let prCount = 0;
  let totalVol = 0;
  let totalCompletedSets = 0;
  let totalPlannedSets = 0;

  const exerciseLogs: ExerciseLog[] = [];
  const setLogs: SetLog[] = [];

  drafts.forEach((d, idx) => {
    const exerciseLogId = newId();
    exerciseLogs.push({
      id: exerciseLogId,
      sessionId,
      exerciseId: d.exerciseId,
      order: idx,
      exerciseName: d.exerciseName,
      muscleGroupName: d.muscleGroupName,
      targetSets: d.targetSets,
      targetRepsMin: d.targetRepsMin,
      targetRepsMax: d.targetRepsMax,
      barWeight: d.barWeight,
      isMachine: d.isMachine,
      ...(d.notes ? { notes: d.notes } : {}),
    });
    totalPlannedSets += d.targetSets;

    const persisted: SetLog[] = d.sets.map((s) => ({
      id: newId(),
      exerciseLogId,
      sessionId,
      exerciseId: d.exerciseId,
      setNumber: s.setNumber,
      weight: s.weight === '' ? 0 : Number(s.weight),
      reps: s.reps === '' ? 0 : Number(s.reps),
      completed: s.completed,
      ...(s.rpe !== '' && s.rpe !== undefined ? { rpe: Number(s.rpe) } : {}),
    }));
    setLogs.push(...persisted);

    const completedSets = persisted.filter((p) => p.completed);
    totalCompletedSets += completedSets.length;
    totalVol += setsVolume(completedSets);

    const currentStats = statsForExercise(
      sessionId,
      d.exerciseId,
      date,
      persisted,
      d.targetSets,
    );
    const allPrev = perExerciseStats[idx] ?? [];
    const prevLast = allPrev.length > 0 ? allPrev[allPrev.length - 1]! : null;
    const tag = compareToPrevious(currentStats, prevLast, allPrev);
    if (currentStats.completedSets > 0 && tag.kind === 'pr') prCount++;
  });

  const score = computeWorkoutScore({
    currentVolume: totalVol,
    prevVolumes,
    prCount,
    plannedSets: totalPlannedSets,
    completedSets: totalCompletedSets,
  });

  const session: Session = {
    id: sessionId,
    workoutId: workout.id,
    planId: workout.planId,
    workoutName: workout.name,
    workoutCode: workout.code,
    date,
    startedAt,
    finishedAt: now(),
    status: 'completed',
    score: score.score,
    ...(notes ? { notes } : {}),
    totalVolume: totalVol,
    prCount,
    completionPct: score.completionPct,
  };

  await db.transaction('rw', [db.sessions, db.exerciseLogs, db.setLogs], async () => {
    await db.sessions.add(session);
    await db.exerciseLogs.bulkAdd(exerciseLogs);
    await db.setLogs.bulkAdd(setLogs);
  });

  return {
    session,
    score: score.score,
    prCount,
    volumeDeltaPct: score.volumeDeltaPct,
    message: score.message,
  };
}

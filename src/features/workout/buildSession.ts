import { db, newId, now } from '@/db/db';
import type {
  Workout,
  Exercise,
  MuscleGroup,
  Session,
  SetLog,
  ExerciseLog,
  ExerciseSessionStats,
} from '@/types';
import type { DraftExercise, WorkoutDraft } from './types';
import {
  computeWorkoutScore,
  statsForExercise,
  compareToPrevious,
  totalVolume as setsVolume,
} from '@/utils/scoring';
import {
  prescribe,
  resolveIncrement,
  pastSetsFromLogs,
  formatLastSets,
  type PastSet,
} from '@/utils/progression';
import { detectStall } from '@/utils/stall';
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

/** The sets logged for this exercise in its most recent completed session. */
async function lastSessionSets(
  exerciseId: string,
  stats: ExerciseSessionStats[],
): Promise<PastSet[]> {
  if (stats.length === 0) return [];
  const lastSessionId = stats[stats.length - 1]!.sessionId;
  const logs = await db.exerciseLogs.where('sessionId').equals(lastSessionId).toArray();
  const log = logs.find((l) => l.exerciseId === exerciseId);
  if (!log) return [];
  const sets = (await db.setLogs.where('exerciseLogId').equals(log.id).toArray()).sort(
    (a, b) => a.setNumber - b.setNumber,
  );
  return pastSetsFromLogs(sets);
}

export async function buildDraftForExercise(
  ex: Exercise,
  group: MuscleGroup,
): Promise<DraftExercise> {
  const stats = await getExerciseStatsHistory(ex.id);
  const lastSets = await lastSessionSets(ex.id, stats);
  const settings = await db.settings.get('singleton');

  const increment = resolveIncrement({
    ...(ex.incrementKg !== undefined ? { incrementKg: ex.incrementKg } : {}),
    ...(ex.isMachine ? { isMachine: true } : {}),
    inventory: settings?.plateInventory ?? [],
  });

  const prescription = prescribe({
    lastSets,
    targetSets: ex.targetSets,
    repsMin: ex.targetRepsMin,
    repsMax: ex.targetRepsMax,
    increment,
    isStalled: detectStall(stats, ex.name) !== null,
    ...(ex.seedWeight !== undefined ? { seedWeight: ex.seedWeight } : {}),
  });

  // Every set is pre-loaded with the prescription as ghost text, so tapping ✓
  // logs exactly what the app told the user to do. Typing over it still wins.
  //
  // Exception: a first-ever session with no seed weight has nothing to
  // prescribe. Leaving ghost reps there would let one tap log a 0 kg set, so we
  // leave the row blank and the ✓ disabled until a weight is entered. Once
  // history exists, a 0 kg top set means genuine bodyweight work and the ghost
  // is correct.
  const hasPrescription = prescription.kind !== 'first' || prescription.weight > 0;
  const sets = Array.from({ length: ex.targetSets }, (_, i) => ({
    setNumber: i + 1,
    weight: '' as number | '',
    reps: '' as number | '',
    completed: false,
    ...(prescription.weight > 0 ? { ghostWeight: prescription.weight } : {}),
    ...(hasPrescription ? { ghostReps: prescription.reps } : {}),
  }));

  const lastSummary = formatLastSets(lastSets);

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
    ...(ex.incrementKg !== undefined ? { incrementKg: ex.incrementKg } : {}),
    order: ex.order,
    sets,
    prescription,
    ...(lastSummary ? { lastSummary } : {}),
  };
}

/**
 * Bring a restored draft back in line with the current plan.
 *
 * A draft is a snapshot, so editing the plan while a session sat open used to
 * be invisible in the logger: the renamed lift kept its old name, a newly added
 * exercise never appeared, and a raised set count did nothing.
 *
 * Only additive and display-level changes are applied — names, targets, rest,
 * bar weight, increment, and appending exercises added to the plan. Logged sets
 * are never touched and an exercise removed from the plan is kept in the draft,
 * because it may already hold work.
 */
export async function reconcileDraftWithPlan(
  workoutId: string,
  drafts: DraftExercise[],
): Promise<DraftExercise[]> {
  const groups = (
    await db.muscleGroups.where('workoutId').equals(workoutId).toArray()
  ).sort((a, b) => a.order - b.order);
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const exercises = (
    await db.exercises.where('muscleGroupId').anyOf(groups.map((g) => g.id)).toArray()
  ).sort((a, b) => a.order - b.order);
  const exById = new Map(exercises.map((e) => [e.id, e]));

  const refreshed = drafts.map((d) => {
    const ex = exById.get(d.exerciseId);
    if (!ex) return d;
    const group = groupById.get(ex.muscleGroupId);
    // Grow the visible rows to a raised target; never shrink, that would drop
    // sets the user has already logged.
    const sets =
      d.sets.length >= ex.targetSets
        ? d.sets
        : [
            ...d.sets,
            ...Array.from({ length: ex.targetSets - d.sets.length }, (_, i) => ({
              setNumber: d.sets.length + i + 1,
              weight: '' as number | '',
              reps: '' as number | '',
              completed: false,
              ...(d.prescription && d.prescription.weight > 0
                ? { ghostWeight: d.prescription.weight, ghostReps: d.prescription.reps }
                : {}),
            })),
          ];
    return {
      ...d,
      exerciseName: ex.name,
      muscleGroupId: ex.muscleGroupId,
      muscleGroupName: group?.name ?? d.muscleGroupName,
      targetSets: ex.targetSets,
      targetRepsMin: ex.targetRepsMin,
      targetRepsMax: ex.targetRepsMax,
      barWeight: ex.barWeight,
      isMachine: !!ex.isMachine,
      defaultRestSec: ex.defaultRestSec,
      ...(ex.notes ? { notes: ex.notes } : {}),
      ...(ex.incrementKg !== undefined ? { incrementKg: ex.incrementKg } : {}),
      sets,
    };
  });

  const present = new Set(drafts.map((d) => d.exerciseId));
  const appended: DraftExercise[] = [];
  for (const ex of exercises) {
    if (present.has(ex.id)) continue;
    const group = groupById.get(ex.muscleGroupId);
    if (!group) continue;
    appended.push(await buildDraftForExercise(ex, group));
  }

  return [
    ...refreshed,
    ...appended.map((d, i) => ({ ...d, order: refreshed.length + i })),
  ];
}

/**
 * Commit an autosaved draft straight to history, without opening the logger.
 * This is the one-tap rescue for "I did the workout and forgot to press Save":
 * the draft already snapshots the workout name/code/plan, so it commits even if
 * the workout was since removed from the plan.
 */
export async function commitDraft(draft: WorkoutDraft): Promise<SaveResult> {
  const workout: Workout =
    (await db.workouts.get(draft.workoutId)) ?? {
      id: draft.workoutId,
      planId: draft.planId,
      name: draft.workoutName,
      code: draft.workoutCode,
      order: 0,
      defaultRestSec: 150,
      createdAt: draft.startedAt,
      updatedAt: draft.startedAt,
    };
  const res = await saveSession({
    workout,
    drafts: draft.drafts,
    date: draft.sessionDate,
    startedAt: draft.startedAt,
    ...(draft.notes.trim() ? { notes: draft.notes.trim() } : {}),
  });
  await db.workoutDrafts.delete(draft.workoutId);
  return res;
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

    // Sets the user never touched are dropped rather than stored as 0 kg × 0.
    // Those phantom rows came back as ghost values in the next session and
    // polluted the set count the progression engine reads.
    const persisted: SetLog[] = d.sets
      .filter((s) => s.completed || s.weight !== '' || s.reps !== '')
      .map((s) => ({
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

    // An exercise the user skipped entirely gets NO log row. Writing an empty
    // one gave it a 0 kg "session" in its history: three skipped workouts and
    // the app declared a lift he never performed to be stalled, and prescribed
    // a deload for it. Its planned sets still count against completion.
    totalPlannedSets += d.targetSets;
    if (persisted.length === 0) return;

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
    plannedSets: totalPlannedSets,
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

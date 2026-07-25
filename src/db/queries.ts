import { db } from './db';
import type {
  ID,
  ISODate,
  ExerciseSessionStats,
  SetLog,
  Session,
  ExerciseLog,
  BodyMeasurement,
} from '@/types';
import type { WorkoutDraft } from '@/features/workout/types';
import { statsForExercise } from '@/utils/scoring';

/** Get all completed sessions for an exercise (ordered oldest → newest). */
export async function getExerciseHistory(exerciseId: ID): Promise<{
  session: Session;
  exerciseLog: ExerciseLog;
  sets: SetLog[];
}[]> {
  const logs = await db.exerciseLogs
    .where('exerciseId')
    .equals(exerciseId)
    .toArray();
  const sessionIds = Array.from(new Set(logs.map((l) => l.sessionId)));
  const sessions = await db.sessions.bulkGet(sessionIds);
  const validSessions = sessions.filter(
    (s): s is Session => s !== undefined && s.status === 'completed',
  );
  const validSessionIds = new Set<string>(validSessions.map((s) => s.id));

  const allSets = await db.setLogs
    .where('exerciseId')
    .equals(exerciseId)
    .toArray();
  const setsByLog = new Map<ID, SetLog[]>();
  for (const s of allSets) {
    const arr = setsByLog.get(s.exerciseLogId) ?? [];
    arr.push(s);
    setsByLog.set(s.exerciseLogId, arr);
  }

  const result = logs
    .filter((l) => validSessionIds.has(l.sessionId))
    .map((l) => {
      const session = validSessions.find((s) => s.id === l.sessionId)!;
      const sets = (setsByLog.get(l.id) ?? []).sort(
        (a, b) => a.setNumber - b.setNumber,
      );
      return { session, exerciseLog: l, sets };
    })
    .sort((a, b) => {
      if (a.session.date !== b.session.date) {
        return a.session.date < b.session.date ? -1 : 1;
      }
      return (a.session.startedAt ?? 0) - (b.session.startedAt ?? 0);
    });
  return result;
}

/** Build per-session stats array for an exercise (oldest → newest). */
export async function getExerciseStatsHistory(
  exerciseId: ID,
): Promise<ExerciseSessionStats[]> {
  const hist = await getExerciseHistory(exerciseId);
  return hist.map((h) =>
    statsForExercise(
      h.session.id,
      exerciseId,
      h.session.date,
      h.sets,
      h.exerciseLog.targetSets,
    ),
  );
}


/** Fetch the autosaved draft for a workout (if any). */
export async function getWorkoutDraft(workoutId: ID): Promise<WorkoutDraft | undefined> {
  return db.workoutDrafts.get(workoutId);
}

/** Did the user actually log anything in this draft? */
export function draftHasWork(d: WorkoutDraft): boolean {
  if (d.notes.trim().length > 0) return true;
  return d.drafts.some((ex) => ex.sets.some((s) => s.completed));
}

/**
 * Delete abandoned drafts that contain NO logged work — a tab that was opened
 * on the workout screen and never used, or an orphan left by an older version
 * of the autosave logic.
 *
 * Drafts that DO contain completed sets are never auto-deleted, at any age.
 * The whole point of the autosave is that forgetting to press "Finish & Save"
 * cannot cost the user a session; a purge that outran him was exactly that
 * data loss with extra steps. Forgotten-but-real sessions are surfaced by
 * `getUnfinishedDrafts` instead, so he can commit them with one tap.
 *
 * Returns count of rows deleted.
 */
export async function purgeEmptyWorkoutDrafts(maxAgeHours = 24): Promise<number> {
  const cutoff = Date.now() - maxAgeHours * 3600 * 1000;
  const stale = await db.workoutDrafts.where('updatedAt').below(cutoff).toArray();
  const empty = stale.filter((d) => !draftHasWork(d));
  if (empty.length === 0) return 0;
  await db.workoutDrafts.bulkDelete(empty.map((d) => d.workoutId));
  return empty.length;
}

/**
 * Drafts holding real work whose session date is already in the past — i.e.
 * workouts the user logged and then forgot to save. Newest first.
 */
export async function getUnfinishedDrafts(today: ISODate): Promise<WorkoutDraft[]> {
  const all = await db.workoutDrafts.toArray();
  return all
    .filter((d) => d.sessionDate < today && draftHasWork(d))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** All body measurements, oldest → newest (suits chart consumption). */
export async function getBodyMeasurementsAsc(): Promise<BodyMeasurement[]> {
  const all = await db.bodyMeasurements.toArray();
  return all.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt - b.createdAt));
}

/** Most recent body measurement (or null). */
export async function getLatestBodyMeasurement(): Promise<BodyMeasurement | null> {
  const all = await getBodyMeasurementsAsc();
  return all.length > 0 ? all[all.length - 1]! : null;
}

/** Get last N completed sessions of same workoutId, oldest → newest. */
export async function getRecentWorkoutSessions(
  workoutId: ID,
  n: number,
): Promise<Session[]> {
  const sessions = await db.sessions
    .where('workoutId')
    .equals(workoutId)
    .toArray();
  return sessions
    .filter((s) => s.status === 'completed')
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (b.startedAt ?? 0) - (a.startedAt ?? 0);
    })
    .slice(0, n)
    .reverse();
}

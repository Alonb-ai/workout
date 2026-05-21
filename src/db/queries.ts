import { db } from './db';
import type {
  ID,
  ExerciseSessionStats,
  SetLog,
  Session,
  ExerciseLog,
} from '@/types';
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

/** Get the most-recent completed session of a workout (used to pre-fill). */
export async function getLastSessionForWorkout(
  workoutId: ID,
): Promise<{ session: Session; logs: ExerciseLog[]; sets: SetLog[] } | null> {
  const sessions = await db.sessions
    .where('workoutId')
    .equals(workoutId)
    .toArray();
  const completed = sessions
    .filter((s) => s.status === 'completed')
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (b.startedAt ?? 0) - (a.startedAt ?? 0);
    });
  const last = completed[0];
  if (!last) return null;
  const logs = await db.exerciseLogs.where('sessionId').equals(last.id).toArray();
  const sets = await db.setLogs.where('sessionId').equals(last.id).toArray();
  return { session: last, logs, sets };
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

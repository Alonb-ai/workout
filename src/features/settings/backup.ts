import { db } from '@/db/db';
import { ensureSettings } from '@/db/seed';

interface ExportPayload {
  version: number;
  exportedAt: number;
  plans: unknown[];
  workouts: unknown[];
  muscleGroups: unknown[];
  exercises: unknown[];
  sessions: unknown[];
  exerciseLogs: unknown[];
  setLogs: unknown[];
  supplements: unknown[];
  supplementLogs: unknown[];
  settings: unknown[];
}

export async function exportAll(): Promise<ExportPayload> {
  const [
    plans,
    workouts,
    muscleGroups,
    exercises,
    sessions,
    exerciseLogs,
    setLogs,
    supplements,
    supplementLogs,
    settings,
  ] = await Promise.all([
    db.plans.toArray(),
    db.workouts.toArray(),
    db.muscleGroups.toArray(),
    db.exercises.toArray(),
    db.sessions.toArray(),
    db.exerciseLogs.toArray(),
    db.setLogs.toArray(),
    db.supplements.toArray(),
    db.supplementLogs.toArray(),
    db.settings.toArray(),
  ]);

  return {
    version: 1,
    exportedAt: Date.now(),
    plans,
    workouts,
    muscleGroups,
    exercises,
    sessions,
    exerciseLogs,
    setLogs,
    supplements,
    supplementLogs,
    settings,
  };
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export async function importAll(rawData: unknown): Promise<void> {
  const data = (rawData ?? {}) as Record<string, unknown>;
  await db.transaction(
    'rw',
    [
      db.plans,
      db.workouts,
      db.muscleGroups,
      db.exercises,
      db.sessions,
      db.exerciseLogs,
      db.setLogs,
      db.supplements,
      db.supplementLogs,
      db.settings,
    ],
    async () => {
      await Promise.all([
        db.plans.clear(),
        db.workouts.clear(),
        db.muscleGroups.clear(),
        db.exercises.clear(),
        db.sessions.clear(),
        db.exerciseLogs.clear(),
        db.setLogs.clear(),
        db.supplements.clear(),
        db.supplementLogs.clear(),
        db.settings.clear(),
      ]);
      // Use casts to internal Dexie types via `as never` — payloads are validated
      // by the shape they were exported with from this same app.
      await db.plans.bulkAdd(asArray(data.plans) as never);
      await db.workouts.bulkAdd(asArray(data.workouts) as never);
      await db.muscleGroups.bulkAdd(asArray(data.muscleGroups) as never);
      await db.exercises.bulkAdd(asArray(data.exercises) as never);
      await db.sessions.bulkAdd(asArray(data.sessions) as never);
      await db.exerciseLogs.bulkAdd(asArray(data.exerciseLogs) as never);
      await db.setLogs.bulkAdd(asArray(data.setLogs) as never);
      await db.supplements.bulkAdd(asArray(data.supplements) as never);
      await db.supplementLogs.bulkAdd(asArray(data.supplementLogs) as never);
      const settingsArr = asArray(data.settings);
      if (settingsArr.length > 0) {
        await db.settings.bulkAdd(settingsArr as never);
      }
    },
  );
  await ensureSettings();
}

export async function wipeAll(): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.plans,
      db.workouts,
      db.muscleGroups,
      db.exercises,
      db.sessions,
      db.exerciseLogs,
      db.setLogs,
      db.supplements,
      db.supplementLogs,
      db.settings,
    ],
    async () => {
      await Promise.all([
        db.plans.clear(),
        db.workouts.clear(),
        db.muscleGroups.clear(),
        db.exercises.clear(),
        db.sessions.clear(),
        db.exerciseLogs.clear(),
        db.setLogs.clear(),
        db.supplements.clear(),
        db.supplementLogs.clear(),
        db.settings.clear(),
      ]);
    },
  );
}

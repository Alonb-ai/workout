import Dexie, { type Table } from 'dexie';
import type {
  Plan,
  Workout,
  MuscleGroup,
  Exercise,
  Session,
  ExerciseLog,
  SetLog,
  Supplement,
  SupplementLog,
  AppSettings,
  BodyMeasurement,
} from '@/types';
import type { WorkoutDraft } from '@/features/workout/types';

/**
 * IronTrackDB
 *
 * Versioning policy:
 *   - Every schema change MUST bump `version()`. Never edit an existing version block.
 *   - Add a new `.version(N).stores({...}).upgrade(tx => ...)` block and write the
 *     migration explicitly. Dexie will run upgrades in order against existing data.
 *   - Snapshot fields on logs (exerciseName, barWeight, etc.) are intentional — they
 *     preserve session history if the source exercise is later renamed or deleted.
 */
export class IronTrackDB extends Dexie {
  plans!: Table<Plan, string>;
  workouts!: Table<Workout, string>;
  muscleGroups!: Table<MuscleGroup, string>;
  exercises!: Table<Exercise, string>;
  sessions!: Table<Session, string>;
  exerciseLogs!: Table<ExerciseLog, string>;
  setLogs!: Table<SetLog, string>;
  supplements!: Table<Supplement, string>;
  supplementLogs!: Table<SupplementLog, string>;
  settings!: Table<AppSettings, string>;
  workoutDrafts!: Table<WorkoutDraft, string>;
  bodyMeasurements!: Table<BodyMeasurement, string>;

  constructor() {
    super('iron-track');

    // v1 — initial schema
    this.version(1).stores({
      plans: 'id, isActive, order',
      workouts: 'id, planId, order, code',
      muscleGroups: 'id, workoutId, order',
      exercises: 'id, muscleGroupId, order',
      sessions: 'id, workoutId, planId, date, status, [workoutId+date]',
      exerciseLogs: 'id, sessionId, exerciseId, order',
      setLogs: 'id, exerciseLogId, sessionId, exerciseId, setNumber',
      supplements: 'id, active, order',
      supplementLogs: 'id, supplementId, date, [supplementId+date]',
      settings: 'id',
    });

    // v2 — adds Web Push fields on Settings. No store shape changes; only
    // backfill the new properties on the existing singleton row.
    this.version(2)
      .stores({
        plans: 'id, isActive, order',
        workouts: 'id, planId, order, code',
        muscleGroups: 'id, workoutId, order',
        exercises: 'id, muscleGroupId, order',
        sessions: 'id, workoutId, planId, date, status, [workoutId+date]',
        exerciseLogs: 'id, sessionId, exerciseId, order',
        setLogs: 'id, exerciseLogId, sessionId, exerciseId, setNumber',
        supplements: 'id, active, order',
        supplementLogs: 'id, supplementId, date, [supplementId+date]',
        settings: 'id',
      })
      .upgrade(async (tx) => {
        const s = await tx.table('settings').get('singleton');
        if (s) {
          await tx.table('settings').put({
            ...s,
            schemaVersion: 2,
            pushBackendUrl: s.pushBackendUrl ?? '',
            pushVapidPublicKey: s.pushVapidPublicKey ?? '',
            pushSharedSecret: s.pushSharedSecret ?? '',
            pushClientId: s.pushClientId ?? '',
            pushSubscribed: s.pushSubscribed ?? false,
            pushLastSyncAt: s.pushLastSyncAt ?? 0,
          });
        }
      });

    // v3 — `workoutDrafts` table for in-progress autosave. Keyed by workoutId,
    // one row per workout. No data migration required (new empty store).
    this.version(3)
      .stores({
        plans: 'id, isActive, order',
        workouts: 'id, planId, order, code',
        muscleGroups: 'id, workoutId, order',
        exercises: 'id, muscleGroupId, order',
        sessions: 'id, workoutId, planId, date, status, [workoutId+date]',
        exerciseLogs: 'id, sessionId, exerciseId, order',
        setLogs: 'id, exerciseLogId, sessionId, exerciseId, setNumber',
        supplements: 'id, active, order',
        supplementLogs: 'id, supplementId, date, [supplementId+date]',
        settings: 'id',
        workoutDrafts: 'workoutId, updatedAt',
      })
      .upgrade(async (tx) => {
        const s = await tx.table('settings').get('singleton');
        if (s) {
          await tx.table('settings').put({ ...s, schemaVersion: 3 });
        }
      });

    // v4 — body measurements + per-user profile fields on Settings. Adds a
    // new `bodyMeasurements` table keyed by id; no migration of existing
    // rows needed (it's empty).
    this.version(4)
      .stores({
        plans: 'id, isActive, order',
        workouts: 'id, planId, order, code',
        muscleGroups: 'id, workoutId, order',
        exercises: 'id, muscleGroupId, order',
        sessions: 'id, workoutId, planId, date, status, [workoutId+date]',
        exerciseLogs: 'id, sessionId, exerciseId, order',
        setLogs: 'id, exerciseLogId, sessionId, exerciseId, setNumber',
        supplements: 'id, active, order',
        supplementLogs: 'id, supplementId, date, [supplementId+date]',
        settings: 'id',
        workoutDrafts: 'workoutId, updatedAt',
        bodyMeasurements: 'id, date',
      })
      .upgrade(async (tx) => {
        const s = await tx.table('settings').get('singleton');
        if (s) {
          await tx.table('settings').put({
            ...s,
            schemaVersion: 4,
            bodyReminderEnabled: s.bodyReminderEnabled ?? false,
            bodyReminderDow: s.bodyReminderDow ?? 0, // Sunday default
            bodyReminderTime: s.bodyReminderTime ?? '09:00',
          });
        }
      });

    // v5 — backfill `barWeight` on barbell lifts that predate the seed carrying
    // one. Every exercise was created with barWeight 0, which left the plate
    // calculator inert on the whole program: it can only run when the exercise
    // has a bar. No store shape change; this is a pure data backfill.
    this.version(5)
      .stores({
        plans: 'id, isActive, order',
        workouts: 'id, planId, order, code',
        muscleGroups: 'id, workoutId, order',
        exercises: 'id, muscleGroupId, order',
        sessions: 'id, workoutId, planId, date, status, [workoutId+date]',
        exerciseLogs: 'id, sessionId, exerciseId, order',
        setLogs: 'id, exerciseLogId, sessionId, exerciseId, setNumber',
        supplements: 'id, active, order',
        supplementLogs: 'id, supplementId, date, [supplementId+date]',
        settings: 'id',
        workoutDrafts: 'workoutId, updatedAt',
        bodyMeasurements: 'id, date',
      })
      .upgrade(async (tx) => {
        const exercises = await tx.table('exercises').toArray();
        for (const ex of exercises) {
          const bar = inferBarWeight(ex);
          if (bar !== null) await tx.table('exercises').update(ex.id, { barWeight: bar });
        }
        const s = await tx.table('settings').get('singleton');
        if (s) await tx.table('settings').put({ ...s, schemaVersion: 5 });
      });
  }
}

/**
 * Guess the bar weight for an exercise that has none, from its name.
 *
 * Deliberately conservative — a wrong bar weight makes the plate calculator lie
 * about what to load, which is worse than it staying switched off. Returns
 * `null` for "leave it alone", which covers machines, dumbbells, anything the
 * user has already configured, and every name we are not sure about.
 * Exported for the unit test; the migration is the only caller.
 */
export function inferBarWeight(ex: {
  name: string;
  barWeight?: number;
  isMachine?: boolean;
}): number | null {
  // Never overwrite a value the user set, and machines have no bar at all.
  if (ex.isMachine) return null;
  if (ex.barWeight !== undefined && ex.barWeight > 0) return null;

  const name = ex.name.toLowerCase();
  // Dumbbell and cable work is loaded per hand/stack — no bar to exclude.
  if (/\b(db|dumbbell|cable|machine|bodyweight)\b/.test(name)) return null;
  if (!/\bbarbell\b|bench press|overhead press|close grip|\bez[- ]?bar\b/.test(name)) return null;

  // Curls are done on an EZ/curl bar in practice; matches what the seed ships.
  if (/curl|\bez[- ]?bar\b/.test(name)) return 10;
  return 20;
}

export const db = new IronTrackDB();

/** Short, URL-safe unique ID. */
export const newId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  }
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
};

export const now = (): number => Date.now();

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
} from '@/types';

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
  }
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

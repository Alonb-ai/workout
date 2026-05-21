import type { ID, ExerciseLog, SetLog } from '@/types';

/** In-memory representation of a set being logged. */
export interface DraftSet {
  setNumber: number;
  weight: number | '';
  reps: number | '';
  rpe?: number | '';
  completed: boolean;
  /** Snapshot from last session for ghost-text and comparisons. */
  ghostWeight?: number;
  ghostReps?: number;
}

/** Draft state for a single exercise within the active session. */
export interface DraftExercise {
  exerciseId: ID;
  exerciseName: string;
  muscleGroupId: ID;
  muscleGroupName: string;
  targetSets: number;
  targetRepsMin: number;
  targetRepsMax: number;
  barWeight: number;
  isMachine: boolean;
  defaultRestSec: number;
  notes?: string;
  seedWeight?: number;
  order: number;
  sets: DraftSet[];
}

export interface BuiltSessionData {
  exerciseLog: Omit<ExerciseLog, 'sessionId'>;
  sets: Omit<SetLog, 'sessionId' | 'exerciseLogId'>[];
}

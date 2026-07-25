import type { ID, ISODate, Timestamp } from '@/types';
import type { Prescription } from '@/utils/progression';

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
  /** Per-exercise loading step; see Exercise.incrementKg. */
  incrementKg?: number;
  order: number;
  sets: DraftSet[];
  /**
   * What the app says to lift today. Derived from history when the draft is
   * built; it rides along into the autosaved draft so a restored session still
   * shows its coaching, rather than being recomputed against a moving target.
   */
  prescription?: Prescription;
  /** Compact recap of the last session, e.g. "40×8,8,7". */
  lastSummary?: string;
}

/**
 * Auto-saved draft for an in-progress workout. Keyed by workoutId — only one
 * draft per workout is kept at a time. Wiped after a successful Finish & Save
 * or an explicit "start over". Lets a session survive refresh / tab close.
 */
export interface WorkoutDraft {
  workoutId: ID;
  planId: ID;
  workoutName: string; // snapshot for dashboard hint
  workoutCode: string; // snapshot for dashboard hint
  drafts: DraftExercise[];
  sessionDate: ISODate;
  notes: string;
  startedAt: Timestamp;
  updatedAt: Timestamp;
}

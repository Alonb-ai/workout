import type { ID, ISODate, Timestamp } from '@/types';
import type { Prescription } from '@/utils/progression';

/** In-memory representation of a set being logged. */
export interface DraftSet {
  setNumber: number;
  weight: number | '';
  reps: number | '';
  rpe?: number | '';
  completed: boolean;
  /**
   * Epoch ms the set was ticked off. Drives the workout clock only; it is not
   * copied into the saved SetLog. Absent on drafts made before it existed.
   */
  completedAt?: number;
  /** Drop set hanging off the set before it. See SetLog.isDrop. */
  isDrop?: boolean;
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
  /** Display copy of the exercise's pinned note (`Exercise.notes`). */
  notes?: string;
  /** Note for this session only; saved to `ExerciseLog.notes`. */
  sessionNote?: string;
  /** The most recent session note for this exercise, shown as a reminder. */
  lastNote?: { text: string; date: ISODate };
  /** See Exercise.supersetGroup. */
  supersetGroup?: string;
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
  /**
   * Plan exercises taken out of THIS session only (removed or swapped for
   * something else). Without it, restoring the draft would re-append them as
   * "exercises added to the plan since". Optional: older drafts lack it.
   */
  removedExerciseIds?: ID[];
  /**
   * The user reordered exercises in this session. Only marks the draft worth
   * keeping across a reload; the order itself is the order of `drafts`.
   */
  reordered?: boolean;
  startedAt: Timestamp;
  updatedAt: Timestamp;
}

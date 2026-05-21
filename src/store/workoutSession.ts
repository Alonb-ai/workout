import { create } from 'zustand';
import type { ID } from '@/types';

/**
 * Transient in-memory state for the *active* workout being logged.
 *
 * The source of truth for sets is local component state in the logger,
 * which persists to Dexie on "Finish & Save". We only store cross-screen
 * UI affordances here (currently-active exercise for the rest timer label,
 * and a draft-session flag if needed later).
 */
interface WorkoutSessionState {
  activeExerciseId: ID | null;
  setActiveExercise: (id: ID | null) => void;
}

export const useWorkoutSessionStore = create<WorkoutSessionState>((set) => ({
  activeExerciseId: null,
  setActiveExercise: (id) => set({ activeExerciseId: id }),
}));

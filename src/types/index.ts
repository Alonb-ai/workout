/**
 * Domain types for Iron Track.
 *
 * Conventions:
 *  - All weights are NET (plates/stack only — bar is excluded from stored/scored values).
 *  - `barWeight` on Exercise is informational only and is used solely by the plate calculator.
 *  - IDs are nanoid-style strings (generated via `crypto.randomUUID` shortened).
 */

export type ID = string;
export type ISODate = string; // YYYY-MM-DD (no time)
export type Timestamp = number; // ms epoch

export type Unit = 'kg' | 'lb';

export interface Plan {
  id: ID;
  name: string;
  description?: string;
  isActive: boolean;
  order: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type WorkoutCode = 'UA' | 'LA' | 'UB' | 'LB' | string;

export interface Workout {
  id: ID;
  planId: ID;
  name: string; // Hebrew display name
  code: WorkoutCode; // short identifier
  order: number;
  defaultRestSec: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface MuscleGroup {
  id: ID;
  workoutId: ID;
  name: string; // Hebrew
  order: number;
}

export interface Exercise {
  id: ID;
  muscleGroupId: ID;
  name: string; // English name as per program
  targetSets: number;
  targetRepsMin: number;
  targetRepsMax: number;
  defaultRestSec: number;
  /** Bar/handle weight in the user's unit. Used ONLY by plate calculator. Default 0. */
  barWeight: number;
  /** True if this lift uses a machine/stack (plate calc shows net only). */
  isMachine?: boolean;
  notes?: string;
  order: number;
  /** Seed starting weight (informational only — used by logger when no prior session). */
  seedWeight?: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type SessionStatus = 'draft' | 'completed';

export interface Session {
  id: ID;
  workoutId: ID;
  planId: ID;
  workoutName: string; // snapshot
  workoutCode: WorkoutCode; // snapshot
  date: ISODate; // session date (defaults today; user-editable)
  startedAt: Timestamp;
  finishedAt?: Timestamp;
  status: SessionStatus;
  score?: number; // 0..100
  notes?: string;
  // computed at save time, stored for fast queries
  totalVolume?: number;
  prCount?: number;
  completionPct?: number;
}

export interface ExerciseLog {
  id: ID;
  sessionId: ID;
  exerciseId: ID;
  order: number;
  // Snapshots at session time
  exerciseName: string;
  muscleGroupName: string;
  targetSets: number;
  targetRepsMin: number;
  targetRepsMax: number;
  barWeight: number;
  isMachine?: boolean;
  notes?: string;
}

export interface SetLog {
  id: ID;
  exerciseLogId: ID;
  sessionId: ID; // denormalised for fast queries
  exerciseId: ID; // denormalised
  setNumber: number;
  /** Net weight (kg). 0 is allowed (bodyweight) but completed=false if both weight & reps empty. */
  weight: number;
  reps: number;
  rpe?: number;
  completed: boolean;
  restSec?: number;
}

export interface Supplement {
  id: ID;
  name: string;
  dose: number;
  unit: string; // mg, g, ml, capsule, scoop...
  color: string; // hex (used for chips)
  withFood: boolean;
  daysOfWeek: number[]; // 0=Sun ... 6=Sat
  times: string[]; // "HH:MM" 24h
  notes?: string;
  active: boolean;
  order: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type SupplementLogStatus = 'taken' | 'skipped' | 'snoozed';

export interface SupplementLog {
  id: ID;
  supplementId: ID;
  date: ISODate;
  scheduledTime: string; // HH:MM
  takenAt?: Timestamp;
  status: SupplementLogStatus;
}

export interface PlatePair {
  weight: number; // single plate weight
  qty: number; // number of plates the user OWNS (NOT pairs). e.g. 4 = 2 pairs of that weight.
}

export interface AppSettings {
  id: 'singleton';
  unit: Unit;
  restTimerDefaultSec: number;
  plateInventory: PlatePair[];
  /** Whether user enabled scheduled supplement notifications. */
  notificationsEnabled: boolean;
  /** Whether to play a sound + vibrate when rest timer ends. */
  restTimerSound: boolean;
  /** Last successful export timestamp. */
  lastBackupAt?: Timestamp;
  /** Tracks dismissed stall suggestions (exerciseId -> last sessionId dismissed). */
  dismissedStalls: Record<ID, ID>;
  /** Onboarding/seed flag. */
  seeded: boolean;
  /** Schema version (mirrors Dexie schema version for reference). */
  schemaVersion: number;
  // ----- Web Push (background notifications via the CF Worker) -----
  /** Base URL of the deployed Cloudflare Worker (e.g. https://iron-track-push.<sub>.workers.dev). */
  pushBackendUrl?: string;
  /** VAPID public key (base64url, 65-byte uncompressed P-256). */
  pushVapidPublicKey?: string;
  /** Optional shared secret sent as X-Shared-Secret header. Empty = no auth. */
  pushSharedSecret?: string;
  /** Stable client identifier used to key this device's subscription on the server. */
  pushClientId?: string;
  /** Whether a push subscription is currently active. */
  pushSubscribed?: boolean;
  /** Last successful /subscribe sync timestamp. */
  pushLastSyncAt?: Timestamp;
}

// ============================================================================
// Computed view types (not persisted)
// ============================================================================

export interface ExerciseSessionStats {
  exerciseId: ID;
  sessionId: ID;
  date: ISODate;
  topWeight: number;
  topReps: number;
  volume: number; // sum(weight * reps) across completed sets
  est1RM: number; // best Epley across completed sets
  completedSets: number;
  plannedSets: number;
}

export interface ComparisonTag {
  kind: 'pr' | 'up' | 'same' | 'down' | 'new';
  label: string; // Hebrew label
  deltaVolumePct?: number;
  deltaTopPct?: number;
}

export interface WorkoutScore {
  score: number; // 0..100
  volume: number;
  volumeAvgPrev3: number;
  volumeDeltaPct: number; // vs avg of last 3
  prCount: number;
  plannedSets: number;
  completedSets: number;
  completionPct: number;
  message: string; // human-friendly Hebrew sentence
}

export interface PlateLayout {
  /** Plates per side, largest first. */
  perSide: number[];
  /** Exact total achievable (bar + 2 * plates). */
  achievedTotal: number;
  /** What the user asked for (bar + net). */
  requestedTotal: number;
  /** Plates net total per side (without bar). */
  perSideNet: number;
  /** Remainder net (achievedTotal - requestedTotal). Negative=under, positive=over. */
  remainderNet: number;
  /** True if exact match. */
  exact: boolean;
  /** No bar (machine/stack): we just show the net. */
  machine: boolean;
}

export interface StallFlag {
  exerciseId: ID;
  exerciseName: string;
  lastThreeSessionIds: ID[];
  topWeight: number;
  reason: string; // Hebrew
}

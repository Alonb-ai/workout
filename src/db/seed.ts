import { db, newId, now } from './db';
import type {
  Plan,
  Workout,
  MuscleGroup,
  Exercise,
  AppSettings,
  PlatePair,
} from '@/types';

/**
 * Seed the database with the user's program: "עוצמה Upper/Lower".
 * Heavy 4–6 rep range; rest 2–3 min; net weights everywhere.
 */

interface ExerciseSeed {
  name: string;
  sets: number;
  repsMin: number;
  repsMax: number;
  restSec?: number;
  isMachine?: boolean;
  seedWeight?: number;
}

interface MuscleGroupSeed {
  name: string;
  exercises: ExerciseSeed[];
}

interface WorkoutSeed {
  name: string;
  code: string;
  groups: MuscleGroupSeed[];
}

const PROGRAM: WorkoutSeed[] = [
  {
    name: 'Upper A — חזה · כתפיים · טריצפס',
    code: 'UA',
    groups: [
      {
        name: 'חזה',
        exercises: [
          { name: 'Barbell Bench Press', sets: 5, repsMin: 3, repsMax: 5, restSec: 180 },
          { name: 'Incline DB Press', sets: 3, repsMin: 5, repsMax: 7, restSec: 150 },
        ],
      },
      {
        name: 'כתפיים',
        exercises: [
          { name: 'Overhead Press', sets: 4, repsMin: 4, repsMax: 6, restSec: 180 },
          { name: 'Lateral Raise', sets: 3, repsMin: 10, repsMax: 12, restSec: 90 },
        ],
      },
      {
        name: 'טריצפס',
        exercises: [
          { name: 'Close Grip Bench', sets: 3, repsMin: 5, repsMax: 7, restSec: 150 },
          { name: 'Overhead Tricep Extension', sets: 3, repsMin: 8, repsMax: 10, restSec: 90 },
        ],
      },
    ],
  },
  {
    name: 'Lower A — ארבע-ראשי · המסטרינג · שוקיים',
    code: 'LA',
    groups: [
      {
        name: 'ארבע-ראשי',
        exercises: [
          { name: 'Leg Press', sets: 5, repsMin: 4, repsMax: 6, restSec: 180, isMachine: true, seedWeight: 80 },
          { name: 'Leg Extension Machine', sets: 3, repsMin: 8, repsMax: 10, restSec: 90, isMachine: true },
        ],
      },
      {
        name: 'המסטרינג',
        exercises: [
          { name: 'DB Romanian Deadlift', sets: 4, repsMin: 5, repsMax: 7, restSec: 150 },
          { name: 'Lying Leg Curl Machine', sets: 3, repsMin: 8, repsMax: 10, restSec: 90, isMachine: true },
        ],
      },
      {
        name: 'שוקיים',
        exercises: [
          { name: 'Standing Calf Raise Machine', sets: 4, repsMin: 6, repsMax: 8, restSec: 90, isMachine: true },
          { name: 'Seated Calf Raise Machine', sets: 3, repsMin: 10, repsMax: 12, restSec: 75, isMachine: true },
        ],
      },
    ],
  },
  {
    name: 'Upper B — גב · ביצפס · בטן',
    code: 'UB',
    groups: [
      {
        name: 'גב-רוחב',
        exercises: [
          { name: 'Weighted Pull-up', sets: 5, repsMin: 3, repsMax: 5, restSec: 180 },
          { name: 'Cable Row', sets: 3, repsMin: 6, repsMax: 8, restSec: 120, isMachine: true },
        ],
      },
      {
        name: 'גב-עומק',
        exercises: [
          { name: 'Barbell Row', sets: 4, repsMin: 4, repsMax: 6, restSec: 180 },
          { name: 'Face Pull', sets: 3, repsMin: 12, repsMax: 15, restSec: 75, isMachine: true },
        ],
      },
      {
        name: 'ביצפס',
        exercises: [
          { name: 'Barbell Curl', sets: 3, repsMin: 6, repsMax: 8, restSec: 90 },
          { name: 'Incline DB Curl', sets: 3, repsMin: 8, repsMax: 10, restSec: 90 },
        ],
      },
      {
        name: 'בטן',
        exercises: [
          { name: 'Ab Wheel Rollout', sets: 3, repsMin: 8, repsMax: 10, restSec: 75 },
          { name: 'Cable Crunch', sets: 3, repsMin: 10, repsMax: 12, restSec: 75, isMachine: true },
          { name: 'Hanging Leg Raise', sets: 3, repsMin: 8, repsMax: 10, restSec: 75 },
        ],
      },
    ],
  },
  {
    name: 'Lower B — ירך אחורית · ארבע-ראשי · שוקיים',
    code: 'LB',
    groups: [
      {
        name: 'ירך אחורית',
        exercises: [
          { name: 'Cable RDL', sets: 4, repsMin: 5, repsMax: 7, restSec: 150, isMachine: true },
          { name: 'Cable Standing Leg Curl', sets: 3, repsMin: 6, repsMax: 8, restSec: 90, isMachine: true },
        ],
      },
      {
        name: 'ארבע-ראשי',
        exercises: [
          { name: 'Hack Squat Machine', sets: 4, repsMin: 5, repsMax: 7, restSec: 180, isMachine: true },
          { name: 'Leg Extension Machine', sets: 3, repsMin: 8, repsMax: 10, restSec: 90, isMachine: true },
        ],
      },
      {
        name: 'שוקיים',
        exercises: [
          { name: 'Standing Calf Raise Machine', sets: 4, repsMin: 6, repsMax: 8, restSec: 90, isMachine: true },
          { name: 'Seated Calf Raise Machine', sets: 3, repsMin: 10, repsMax: 12, restSec: 75, isMachine: true },
        ],
      },
    ],
  },
];

const DEFAULT_PLATES: PlatePair[] = [
  { weight: 20, qty: 4 },
  { weight: 15, qty: 2 },
  { weight: 10, qty: 4 },
  { weight: 5, qty: 4 },
  { weight: 2.5, qty: 4 },
  { weight: 1.25, qty: 4 },
];

export const DEFAULT_SETTINGS: AppSettings = {
  id: 'singleton',
  unit: 'kg',
  restTimerDefaultSec: 150,
  plateInventory: DEFAULT_PLATES,
  notificationsEnabled: false,
  restTimerSound: true,
  dismissedStalls: {},
  seeded: false,
  schemaVersion: 3,
  pushBackendUrl: '',
  pushVapidPublicKey: '',
  pushSharedSecret: '',
  pushClientId: '',
  pushSubscribed: false,
  pushLastSyncAt: 0,
};

export async function seedIfNeeded(): Promise<void> {
  const settings = await db.settings.get('singleton');
  if (settings?.seeded) return;

  await db.transaction(
    'rw',
    [
      db.plans,
      db.workouts,
      db.muscleGroups,
      db.exercises,
      db.settings,
    ],
    async () => {
      const t = now();

      const plan: Plan = {
        id: newId(),
        name: 'עוצמה Upper/Lower',
        description: 'תכנית כוח 4–6 חזרות, מנוחה 2–3 דקות.',
        isActive: true,
        order: 0,
        createdAt: t,
        updatedAt: t,
      };
      await db.plans.add(plan);

      for (let wi = 0; wi < PROGRAM.length; wi++) {
        const ws = PROGRAM[wi]!;
        const workout: Workout = {
          id: newId(),
          planId: plan.id,
          name: ws.name,
          code: ws.code,
          order: wi,
          defaultRestSec: 150,
          createdAt: t,
          updatedAt: t,
        };
        await db.workouts.add(workout);

        for (let gi = 0; gi < ws.groups.length; gi++) {
          const gs = ws.groups[gi]!;
          const group: MuscleGroup = {
            id: newId(),
            workoutId: workout.id,
            name: gs.name,
            order: gi,
          };
          await db.muscleGroups.add(group);

          for (let ei = 0; ei < gs.exercises.length; ei++) {
            const es = gs.exercises[ei]!;
            const ex: Exercise = {
              id: newId(),
              muscleGroupId: group.id,
              name: es.name,
              targetSets: es.sets,
              targetRepsMin: es.repsMin,
              targetRepsMax: es.repsMax,
              defaultRestSec: es.restSec ?? 150,
              barWeight: 0,
              isMachine: es.isMachine ?? false,
              order: ei,
              ...(es.seedWeight !== undefined ? { seedWeight: es.seedWeight } : {}),
              createdAt: t,
              updatedAt: t,
            };
            await db.exercises.add(ex);
          }
        }
      }

      const merged: AppSettings = { ...DEFAULT_SETTINGS, ...(settings ?? {}), seeded: true };
      await db.settings.put(merged);
    },
  );
}

/** Ensure a settings row exists even if seeding ran in a prior version. */
export async function ensureSettings(): Promise<AppSettings> {
  const existing = await db.settings.get('singleton');
  if (existing) {
    // Backfill any new fields that didn't exist when the row was first written.
    const merged: AppSettings = { ...DEFAULT_SETTINGS, ...existing };
    if (JSON.stringify(merged) !== JSON.stringify(existing)) {
      await db.settings.put(merged);
    }
    return merged;
  }
  await db.settings.put(DEFAULT_SETTINGS);
  return DEFAULT_SETTINGS;
}

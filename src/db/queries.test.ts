import { describe, it, expect, beforeEach } from 'vitest';
import { db, inferBarWeight } from './db';
import {
  draftHasWork,
  purgeEmptyWorkoutDrafts,
  getUnfinishedDrafts,
  getExerciseStatsHistory,
  getRecentWorkoutSessions,
} from './queries';
import type { WorkoutDraft, DraftExercise } from '@/features/workout/types';
import type { Session, ExerciseLog, SetLog } from '@/types';

const HOUR = 3600 * 1000;

function draftExercise(overrides: Partial<DraftExercise> = {}): DraftExercise {
  return {
    exerciseId: 'ex1',
    exerciseName: 'Bench',
    muscleGroupId: 'g1',
    muscleGroupName: 'חזה',
    targetSets: 3,
    targetRepsMin: 5,
    targetRepsMax: 8,
    barWeight: 20,
    isMachine: false,
    defaultRestSec: 150,
    order: 0,
    sets: [
      { setNumber: 1, weight: '', reps: '', completed: false },
      { setNumber: 2, weight: '', reps: '', completed: false },
    ],
    ...overrides,
  };
}

function makeDraft(overrides: Partial<WorkoutDraft> = {}): WorkoutDraft {
  return {
    workoutId: 'w1',
    planId: 'p1',
    workoutName: 'Upper A',
    workoutCode: 'UA',
    drafts: [draftExercise()],
    sessionDate: '2026-07-25',
    notes: '',
    startedAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

const worked = () =>
  draftExercise({
    sets: [
      { setNumber: 1, weight: 60, reps: 8, completed: true },
      { setNumber: 2, weight: '', reps: '', completed: false },
    ],
  });

beforeEach(async () => {
  await db.open();
  await Promise.all([
    db.workoutDrafts.clear(),
    db.sessions.clear(),
    db.exerciseLogs.clear(),
    db.setLogs.clear(),
  ]);
});

describe('draftHasWork', () => {
  it('is false for an untouched draft', () => {
    expect(draftHasWork(makeDraft())).toBe(false);
  });

  it('is true once any set is completed', () => {
    expect(draftHasWork(makeDraft({ drafts: [worked()] }))).toBe(true);
  });

  it('is true when only a note was written', () => {
    expect(draftHasWork(makeDraft({ notes: 'כתף כאבה' }))).toBe(true);
  });

  it('ignores whitespace-only notes', () => {
    expect(draftHasWork(makeDraft({ notes: '   \n ' }))).toBe(false);
  });

  it('ignores typed-but-unchecked sets — nothing was confirmed', () => {
    const typed = draftExercise({
      sets: [{ setNumber: 1, weight: 60, reps: 8, completed: false }],
    });
    expect(draftHasWork(makeDraft({ drafts: [typed] }))).toBe(false);
  });
});

describe('purgeEmptyWorkoutDrafts', () => {
  it('deletes an old draft with no logged work', async () => {
    await db.workoutDrafts.put(makeDraft({ updatedAt: Date.now() - 48 * HOUR }));
    expect(await purgeEmptyWorkoutDrafts(24)).toBe(1);
    expect(await db.workoutDrafts.count()).toBe(0);
  });

  it('NEVER deletes a draft containing completed sets, however old', async () => {
    await db.workoutDrafts.put(
      makeDraft({ drafts: [worked()], updatedAt: Date.now() - 365 * 24 * HOUR }),
    );
    expect(await purgeEmptyWorkoutDrafts(24)).toBe(0);
    expect(await db.workoutDrafts.count()).toBe(1);
  });

  it('leaves a fresh empty draft alone', async () => {
    await db.workoutDrafts.put(makeDraft({ updatedAt: Date.now() - 1 * HOUR }));
    expect(await purgeEmptyWorkoutDrafts(24)).toBe(0);
    expect(await db.workoutDrafts.count()).toBe(1);
  });

  it('purges only the empty ones from a mixed set', async () => {
    await db.workoutDrafts.bulkPut([
      makeDraft({ workoutId: 'empty', updatedAt: Date.now() - 48 * HOUR }),
      makeDraft({ workoutId: 'real', drafts: [worked()], updatedAt: Date.now() - 48 * HOUR }),
    ]);
    expect(await purgeEmptyWorkoutDrafts(24)).toBe(1);
    expect((await db.workoutDrafts.toArray()).map((d) => d.workoutId)).toEqual(['real']);
  });
});

describe('getUnfinishedDrafts', () => {
  it('surfaces a draft from a previous day that has work in it', async () => {
    await db.workoutDrafts.put(
      makeDraft({ sessionDate: '2026-07-24', drafts: [worked()] }),
    );
    const found = await getUnfinishedDrafts('2026-07-25');
    expect(found).toHaveLength(1);
    expect(found[0]!.workoutId).toBe('w1');
  });

  it("ignores today's in-progress draft", async () => {
    await db.workoutDrafts.put(
      makeDraft({ sessionDate: '2026-07-25', drafts: [worked()] }),
    );
    expect(await getUnfinishedDrafts('2026-07-25')).toHaveLength(0);
  });

  it('ignores an old draft with nothing logged', async () => {
    await db.workoutDrafts.put(makeDraft({ sessionDate: '2026-07-01' }));
    expect(await getUnfinishedDrafts('2026-07-25')).toHaveLength(0);
  });

  it('returns newest first', async () => {
    await db.workoutDrafts.bulkPut([
      makeDraft({ workoutId: 'older', sessionDate: '2026-07-20', drafts: [worked()], updatedAt: 100 }),
      makeDraft({ workoutId: 'newer', sessionDate: '2026-07-23', drafts: [worked()], updatedAt: 200 }),
    ]);
    const found = await getUnfinishedDrafts('2026-07-25');
    expect(found.map((d) => d.workoutId)).toEqual(['newer', 'older']);
  });
});

// ---------------------------------------------------------------------------
// History queries: these feed the progression engine, so a wrong sort order or
// a leaked draft session silently corrupts every weight the app prescribes.
// ---------------------------------------------------------------------------

async function seedSession(args: {
  id: string;
  date: string;
  status?: 'draft' | 'completed';
  volume?: number;
  sets: { weight: number; reps: number; completed?: boolean }[];
}): Promise<void> {
  const session: Session = {
    id: args.id,
    workoutId: 'w1',
    planId: 'p1',
    workoutName: 'Upper A',
    workoutCode: 'UA',
    date: args.date,
    startedAt: new Date(args.date + 'T10:00:00').getTime(),
    status: args.status ?? 'completed',
    totalVolume: args.volume ?? 0,
  };
  const log: ExerciseLog = {
    id: `log-${args.id}`,
    sessionId: args.id,
    exerciseId: 'ex1',
    order: 0,
    exerciseName: 'Bench',
    muscleGroupName: 'חזה',
    targetSets: 3,
    targetRepsMin: 5,
    targetRepsMax: 8,
    barWeight: 20,
  };
  const sets: SetLog[] = args.sets.map((s, i) => ({
    id: `set-${args.id}-${i}`,
    exerciseLogId: log.id,
    sessionId: args.id,
    exerciseId: 'ex1',
    setNumber: i + 1,
    weight: s.weight,
    reps: s.reps,
    completed: s.completed ?? true,
  }));
  await db.sessions.put(session);
  await db.exerciseLogs.put(log);
  await db.setLogs.bulkPut(sets);
}

describe('getExerciseStatsHistory', () => {
  it('returns completed sessions oldest → newest', async () => {
    await seedSession({ id: 's2', date: '2026-07-20', sets: [{ weight: 60, reps: 8 }] });
    await seedSession({ id: 's1', date: '2026-07-13', sets: [{ weight: 55, reps: 8 }] });
    const hist = await getExerciseStatsHistory('ex1');
    expect(hist.map((h) => h.date)).toEqual(['2026-07-13', '2026-07-20']);
    expect(hist[hist.length - 1]!.topWeight).toBe(60);
  });

  it('excludes sessions still in draft status', async () => {
    await seedSession({ id: 'sd', date: '2026-07-21', status: 'draft', sets: [{ weight: 99, reps: 8 }] });
    await seedSession({ id: 'sc', date: '2026-07-20', sets: [{ weight: 60, reps: 8 }] });
    const hist = await getExerciseStatsHistory('ex1');
    expect(hist).toHaveLength(1);
    expect(hist[0]!.topWeight).toBe(60);
  });

  it('computes volume from completed sets only', async () => {
    await seedSession({
      id: 's1',
      date: '2026-07-20',
      sets: [
        { weight: 60, reps: 8 },
        { weight: 60, reps: 5, completed: false },
      ],
    });
    const hist = await getExerciseStatsHistory('ex1');
    expect(hist[0]!.volume).toBe(480);
    expect(hist[0]!.completedSets).toBe(1);
  });
});

describe('getRecentWorkoutSessions', () => {
  it('returns the last N completed sessions oldest → newest', async () => {
    for (const d of ['2026-07-01', '2026-07-08', '2026-07-15', '2026-07-22']) {
      await seedSession({ id: `s-${d}`, date: d, volume: 100, sets: [{ weight: 60, reps: 8 }] });
    }
    const recent = await getRecentWorkoutSessions('w1', 3);
    expect(recent.map((s) => s.date)).toEqual(['2026-07-08', '2026-07-15', '2026-07-22']);
  });

  it('breaks a same-date tie by start time, newest kept', async () => {
    await seedSession({ id: 'a', date: '2026-07-22', sets: [{ weight: 60, reps: 8 }] });
    await db.sessions.update('a', { startedAt: 1 });
    await seedSession({ id: 'b', date: '2026-07-22', sets: [{ weight: 65, reps: 8 }] });
    await db.sessions.update('b', { startedAt: 2 });
    const recent = await getRecentWorkoutSessions('w1', 1);
    expect(recent.map((s) => s.id)).toEqual(['b']);
  });
});

// ---------------------------------------------------------------------------
// The v5 bar-weight backfill. A wrong bar weight makes the plate calculator
// state the wrong load, so "leave it alone" has to be the default answer.
// ---------------------------------------------------------------------------

describe('inferBarWeight', () => {
  const ex = (name: string, extra: { barWeight?: number; isMachine?: boolean } = {}) => ({
    name,
    ...extra,
  });

  it('gives an Olympic bar to the obvious barbell lifts', () => {
    expect(inferBarWeight(ex('Barbell Bench Press'))).toBe(20);
    expect(inferBarWeight(ex('Barbell Row'))).toBe(20);
    expect(inferBarWeight(ex('Overhead Press'))).toBe(20);
    expect(inferBarWeight(ex('Close Grip Bench'))).toBe(20);
  });

  it('gives curls the lighter curl bar', () => {
    expect(inferBarWeight(ex('Barbell Curl'))).toBe(10);
    expect(inferBarWeight(ex('EZ-Bar Curl'))).toBe(10);
  });

  it('leaves a weight the user already set alone', () => {
    expect(inferBarWeight(ex('Barbell Bench Press', { barWeight: 15 }))).toBeNull();
  });

  it('never touches a machine, even one named like a barbell lift', () => {
    expect(inferBarWeight(ex('Barbell Row', { isMachine: true }))).toBeNull();
  });

  it('leaves dumbbell, cable and machine work alone', () => {
    expect(inferBarWeight(ex('Incline DB Press'))).toBeNull();
    expect(inferBarWeight(ex('DB Romanian Deadlift'))).toBeNull();
    expect(inferBarWeight(ex('Cable Row'))).toBeNull();
    expect(inferBarWeight(ex('Leg Extension Machine'))).toBeNull();
  });

  it('says nothing about a lift it cannot recognise', () => {
    expect(inferBarWeight(ex('Weighted Pull-up'))).toBeNull();
    expect(inferBarWeight(ex('Lateral Raise'))).toBeNull();
    expect(inferBarWeight(ex('פרפר בפולי'))).toBeNull();
  });

  it('treats barWeight 0 as unset rather than as a decision', () => {
    expect(inferBarWeight(ex('Barbell Bench Press', { barWeight: 0 }))).toBe(20);
  });
});

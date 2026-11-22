import { describe, it, expect, beforeEach } from 'vitest';
import Dexie from 'dexie';
import { db } from './db';
import {
  archiveExercises,
  deleteArchivedExercise,
  historySummary,
  linkHistory,
  placeExercise,
  removeExerciseFromPlan,
  repairLiveDatabase,
  retireExercises,
  swapInPlan,
  unlinkHistory,
} from './exerciseLibrary';
import { repairExerciseLinks } from './repair';
import { getExerciseHistory } from './queries';
import { buildDraftFromWorkout, reconcileDraftWithPlan } from '@/features/workout/buildSession';
import type { Exercise, ExerciseLog, Session, SetLog } from '@/types';

const T = 1_700_000_000_000;

function ex(id: string, name: string, muscleGroupId = 'g1', extra: Partial<Exercise> = {}): Exercise {
  return {
    id,
    muscleGroupId,
    name,
    targetSets: 3,
    targetRepsMin: 6,
    targetRepsMax: 10,
    defaultRestSec: 120,
    barWeight: 0,
    order: 0,
    createdAt: T,
    updatedAt: T,
    ...extra,
  };
}

/** One completed session with one logged exercise and `reps.length` sets. */
async function logSession(
  sessionId: string,
  date: string,
  exerciseId: string,
  exerciseName: string,
  weight: number,
  reps: number[],
): Promise<void> {
  const session: Session = {
    id: sessionId,
    workoutId: 'w1',
    planId: 'p1',
    workoutName: 'Upper A',
    workoutCode: 'UA',
    date,
    startedAt: T,
    status: 'completed',
  };
  const log: ExerciseLog = {
    id: `${sessionId}-${exerciseId}`,
    sessionId,
    exerciseId,
    order: 0,
    exerciseName,
    muscleGroupName: 'גב',
    targetSets: reps.length,
    targetRepsMin: 6,
    targetRepsMax: 10,
    barWeight: 0,
  };
  const sets: SetLog[] = reps.map((r, i) => ({
    id: `${log.id}-${i}`,
    exerciseLogId: log.id,
    sessionId,
    exerciseId,
    setNumber: i + 1,
    weight,
    reps: r,
    completed: true,
  }));
  if (!(await db.sessions.get(sessionId))) await db.sessions.add(session);
  await db.exerciseLogs.add(log);
  await db.setLogs.bulkAdd(sets);
}

beforeEach(async () => {
  await db.open();
  await Promise.all(db.tables.map((t) => t.clear()));
  await db.plans.add({ id: 'p1', name: 'P', isActive: true, order: 0, createdAt: T, updatedAt: T });
  await db.workouts.bulkAdd([
    { id: 'w1', planId: 'p1', name: 'יום 1 — חזה', code: '1', order: 0, defaultRestSec: 120, createdAt: T, updatedAt: T },
    { id: 'w2', planId: 'p1', name: 'יום 2 — גב', code: '2', order: 1, defaultRestSec: 120, createdAt: T, updatedAt: T },
  ]);
  await db.muscleGroups.bulkAdd([
    { id: 'g1', workoutId: 'w1', name: 'חזה', order: 0 },
    { id: 'g2', workoutId: 'w2', name: 'גב', order: 0 },
  ]);
});

describe('repairExerciseLinks — logs whose exercise row was deleted', () => {
  it('links an orphan into the one exercise with the same name, without touching a log', async () => {
    await db.exercises.add(ex('live', 'מתח', 'g2'));
    await logSession('s1', '2026-05-01', 'gone', 'מתח', 0, [8, 8, 7]);
    await logSession('s2', '2026-09-01', 'live', 'מתח', 0, [9, 9, 8]);
    const logsBefore = await db.exerciseLogs.toArray();

    const report = await repairLiveDatabase();

    expect(report.linked).toEqual([{ orphanId: 'gone', intoId: 'live', name: 'מתח' }]);
    expect((await db.exercises.get('live'))?.historyIds).toEqual(['gone']);
    expect(await db.exerciseLogs.toArray()).toEqual(logsBefore);
    const hist = await getExerciseHistory('live');
    expect(hist.map((h) => h.session.date)).toEqual(['2026-05-01', '2026-09-01']);
  });

  it('gives an orphan with no namesake an archived row of its own, from the latest snapshot', async () => {
    await logSession('s1', '2026-05-01', 'gone', 'פטישים בעמידה', 10, [10, 10]);
    await logSession('s2', '2026-06-01', 'gone', 'פטישים בשיפוע', 12, [8, 8]);

    const report = await repairLiveDatabase();

    expect(report.restored).toEqual([{ id: 'gone', name: 'פטישים בשיפוע' }]);
    const row = await db.exercises.get('gone');
    expect(row?.archivedAt).toBeDefined();
    expect(row?.archivedFrom).toEqual({ workoutName: 'Upper A', groupName: 'גב' });
    expect((await getExerciseHistory('gone')).length).toBe(2);
  });

  it('does not link when the two were logged in the same session (they are different lifts)', async () => {
    await db.exercises.add(ex('live', 'Row', 'g2'));
    await logSession('s1', '2026-05-01', 'live', 'Row', 50, [8]);
    await logSession('s1', '2026-05-01', 'gone', 'Row', 30, [12]);
    const report = await repairLiveDatabase();
    expect(report.linked).toEqual([]);
    expect(report.restored.map((r) => r.id)).toEqual(['gone']);
  });

  it('is idempotent', async () => {
    await logSession('s1', '2026-05-01', 'gone', 'X', 10, [10]);
    await repairLiveDatabase();
    const again = await repairLiveDatabase();
    expect(again).toEqual({ linked: [], restored: [] });
    expect(await db.exercises.count()).toBe(1);
  });

  it('runs as the v6 upgrade on a v5 database', async () => {
    db.close();
    await Dexie.delete('iron-track');
    const v5 = new Dexie('iron-track');
    v5.version(5).stores({
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
    });
    await v5.open();
    await v5.table('exercises').add(ex('live', 'מתח', 'g2'));
    await v5.table('sessions').add({ id: 's1', workoutId: 'old', planId: 'p0', workoutName: 'Upper B', workoutCode: 'UB', date: '2026-05-01', startedAt: T, status: 'completed' });
    await v5.table('exerciseLogs').bulkAdd([
      { id: 'l1', sessionId: 's1', exerciseId: 'gone1', order: 0, exerciseName: 'מתח', muscleGroupName: 'גב', targetSets: 3, targetRepsMin: 6, targetRepsMax: 10, barWeight: 0 },
      { id: 'l2', sessionId: 's1', exerciseId: 'gone2', order: 1, exerciseName: 'אולרים', muscleGroupName: 'בטן', targetSets: 3, targetRepsMin: 6, targetRepsMax: 10, barWeight: 0 },
    ]);
    await v5.table('settings').add({ id: 'singleton', schemaVersion: 5 });
    v5.close();

    await db.open();
    expect(db.verno).toBe(6);
    expect((await db.exercises.get('live'))?.historyIds).toEqual(['gone1']);
    expect((await db.exercises.get('gone2'))?.archivedAt).toBeDefined();
    expect((await db.settings.get('singleton'))?.schemaVersion).toBe(6);
    expect(await db.exerciseLogs.count()).toBe(2);
  });

  it('accepts a plain table getter (used by the upgrade)', async () => {
    await logSession('s1', '2026-05-01', 'gone', 'X', 10, [10]);
    const r = await db.transaction('rw', [db.exercises, db.exerciseLogs, db.sessions], () =>
      repairExerciseLinks((n) => db.table(n)),
    );
    expect(r.restored).toHaveLength(1);
  });
});

describe('removing exercises never loses history', () => {
  it('archives an exercise with history and deletes one without', async () => {
    await db.exercises.bulkAdd([ex('a', 'Bench'), ex('b', 'Fly')]);
    await logSession('s1', '2026-05-01', 'a', 'Bench', 60, [5, 5]);

    expect(await removeExerciseFromPlan('a')).toBe('archived');
    expect(await removeExerciseFromPlan('b')).toBe('deleted');

    const a = await db.exercises.get('a');
    expect(a?.archivedAt).toBeDefined();
    expect(a?.archivedFrom).toEqual({ workoutName: 'יום 1 — חזה', groupName: 'חזה' });
    expect(await db.exercises.get('b')).toBeUndefined();
    expect((await getExerciseHistory('a')).length).toBe(1);
  });

  it('treats an exercise sitting in an open draft as in use', async () => {
    await db.exercises.add(ex('a', 'Bench'));
    await db.workoutDrafts.add({
      workoutId: 'w1', planId: 'p1', workoutName: 'x', workoutCode: 'x', sessionDate: '2026-05-01', notes: '', startedAt: T, updatedAt: T,
      drafts: [{ exerciseId: 'a', exerciseName: 'Bench', muscleGroupId: 'g1', muscleGroupName: 'חזה', targetSets: 1, targetRepsMin: 5, targetRepsMax: 8, barWeight: 0, isMachine: false, defaultRestSec: 90, order: 0, sets: [] }],
    });
    expect(await retireExercises(['a'])).toBe(1);
    expect(await deleteArchivedExercise('a')).toBe(false);
  });

  it('an archived exercise is not loaded into the next session, and comes back when placed', async () => {
    await db.exercises.bulkAdd([ex('a', 'Bench'), ex('b', 'Fly', 'g1', { order: 1 })]);
    await archiveExercises(['b']);
    let built = await buildDraftFromWorkout('w1');
    expect(built?.drafts.map((d) => d.exerciseId)).toEqual(['a']);

    await placeExercise('b', 'g1');
    built = await buildDraftFromWorkout('w1');
    expect(built?.drafts.map((d) => d.exerciseId)).toEqual(['a', 'b']);
    expect((await db.exercises.get('b'))?.archivedAt).toBeUndefined();
  });

  it('moving an exercise to another workout keeps its id and history', async () => {
    await db.exercises.add(ex('a', 'Row'));
    await logSession('s1', '2026-05-01', 'a', 'Row', 50, [8]);
    await placeExercise('a', 'g2');
    expect((await db.exercises.get('a'))?.muscleGroupId).toBe('g2');
    expect((await buildDraftFromWorkout('w2'))?.drafts[0]?.lastSummary).toBeDefined();
  });

  it('a permanent swap puts the new exercise in the old slot and archives the old one', async () => {
    await db.exercises.bulkAdd([
      ex('a', 'Bench', 'g1', { order: 0 }),
      ex('b', 'Fly', 'g1', { order: 1 }),
      ex('c', 'Machine press', 'g2', { order: 0, archivedAt: T }),
    ]);
    await swapInPlan('a', 'c');
    const c = await db.exercises.get('c');
    expect(c?.muscleGroupId).toBe('g1');
    expect(c?.order).toBe(0);
    expect(c?.archivedAt).toBeUndefined();
    expect((await db.exercises.get('a'))?.archivedAt).toBeDefined();
    expect((await buildDraftFromWorkout('w1'))?.drafts.map((d) => d.exerciseId)).toEqual(['c', 'b']);
  });
});

describe('linked history', () => {
  it('linking folds history in non-destructively, and unlinking restores it exactly', async () => {
    await db.exercises.bulkAdd([ex('new', 'Hammer curl', 'g2'), ex('old', 'פטישים', 'g2', { archivedAt: T })]);
    await logSession('s1', '2026-05-01', 'old', 'פטישים', 10, [10, 10]);
    await logSession('s2', '2026-06-01', 'new', 'Hammer curl', 12, [8, 8]);

    await linkHistory('old', 'new');
    expect((await getExerciseHistory('new')).length).toBe(2);
    expect((await db.exercises.get('old'))?.mergedInto).toBe('new');
    const summary = await historySummary([(await db.exercises.get('new'))!]);
    expect(summary.get('new')).toEqual({ sessions: 2, lastDate: '2026-06-01' });

    await unlinkHistory('new', 'old');
    expect((await getExerciseHistory('new')).length).toBe(1);
    expect((await db.exercises.get('old'))?.mergedInto).toBeUndefined();
    expect((await getExerciseHistory('old')).length).toBe(1);
  });

  it('progression reads linked history: the last session of a linked row seeds the ghost values', async () => {
    await db.exercises.add(ex('copy', 'Row', 'g2', { historyIds: ['orig'] }));
    await logSession('s1', '2026-05-01', 'orig', 'Row', 50, [10, 10, 10]);
    const built = await buildDraftFromWorkout('w2');
    expect(built?.drafts[0]?.lastSummary).toContain('50');
    expect(built?.drafts[0]?.sets[0]?.ghostWeight).toBeGreaterThanOrEqual(50);
  });
});

describe('session-only removal survives a draft restore', () => {
  it('reconcile does not re-append an exercise removed from this session', async () => {
    await db.exercises.bulkAdd([ex('a', 'Bench', 'g1', { order: 0 }), ex('b', 'Fly', 'g1', { order: 1 })]);
    const built = await buildDraftFromWorkout('w1');
    const onlyA = built!.drafts.filter((d) => d.exerciseId === 'a');
    expect((await reconcileDraftWithPlan('w1', onlyA)).map((d) => d.exerciseId)).toEqual(['a', 'b']);
    expect((await reconcileDraftWithPlan('w1', onlyA, ['b'])).map((d) => d.exerciseId)).toEqual(['a']);
  });

  it('reconcile never appends an archived exercise', async () => {
    await db.exercises.bulkAdd([ex('a', 'Bench'), ex('b', 'Fly', 'g1', { archivedAt: T })]);
    const built = await buildDraftFromWorkout('w1');
    expect((await reconcileDraftWithPlan('w1', built!.drafts)).map((d) => d.exerciseId)).toEqual(['a']);
  });
});

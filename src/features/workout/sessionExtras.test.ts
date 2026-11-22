import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/db/db';
import {
  buildDraftFromWorkout,
  reconcileDraftWithPlan,
  saveSession,
} from './buildSession';
import { statsForExercise } from '@/utils/scoring';
import { pastSetsFromLogs } from '@/utils/progression';
import type { Exercise, SetLog, Workout } from '@/types';
import type { DraftExercise } from './types';

const T = 1_700_000_000_000;

const workout: Workout = {
  id: 'w1',
  planId: 'p1',
  name: 'יום 1',
  code: '1',
  order: 0,
  defaultRestSec: 120,
  createdAt: T,
  updatedAt: T,
};

function ex(id: string, name: string, extra: Partial<Exercise> = {}): Exercise {
  return {
    id,
    muscleGroupId: 'g1',
    name,
    targetSets: 3,
    targetRepsMin: 6,
    targetRepsMax: 8,
    defaultRestSec: 120,
    barWeight: 0,
    order: 0,
    createdAt: T,
    updatedAt: T,
    ...extra,
  };
}

function done(weight: number, reps: number, extra: Partial<DraftExercise['sets'][number]> = {}) {
  return { setNumber: 0, weight, reps, completed: true, ...extra };
}

async function draftFor(id: string): Promise<DraftExercise> {
  const res = await buildDraftFromWorkout('w1');
  const d = res?.drafts.find((x) => x.exerciseId === id);
  if (!d) throw new Error('no draft');
  return d;
}

beforeEach(async () => {
  await db.open();
  await Promise.all(db.tables.map((t) => t.clear()));
  await db.plans.add({ id: 'p1', name: 'P', isActive: true, order: 0, createdAt: T, updatedAt: T });
  await db.workouts.add(workout);
  await db.muscleGroups.add({ id: 'g1', workoutId: 'w1', name: 'חזה', order: 0 });
});

describe('exercise notes', () => {
  it('shows the pinned note every session and last session’s own note as a reminder', async () => {
    await db.exercises.add(ex('e1', 'לחיצת חזה מכונה', { notes: 'כיסא בגובה 4' }));
    const first = await draftFor('e1');
    expect(first.notes).toBe('כיסא בגובה 4');
    expect(first.lastNote).toBeUndefined();

    await saveSession({
      workout,
      drafts: [
        {
          ...first,
          sessionNote: 'להישאר עם 70 עד 8×6',
          sets: [done(70, 8), done(70, 7), done(70, 6)].map((s, i) => ({ ...s, setNumber: i + 1 })),
        },
      ],
      date: '2026-11-20',
      startedAt: T,
    });

    const log = (await db.exerciseLogs.toArray())[0]!;
    // Only what was written in that session is stored on the log.
    expect(log.notes).toBe('להישאר עם 70 עד 8×6');

    const next = await draftFor('e1');
    expect(next.notes).toBe('כיסא בגובה 4');
    expect(next.lastNote).toEqual({ text: 'להישאר עם 70 עד 8×6', date: '2026-11-20' });
    expect(next.sessionNote).toBe('');
  });

  it('ignores old logs that only carry a copy of the pinned note or a system marker', async () => {
    await db.exercises.add(ex('e1', 'פרפר', { notes: 'מכונה שהיא יד יד' }));
    const d = await draftFor('e1');
    for (const [i, note] of ['מכונה שהיא יד יד', '[נוסף באימון בודד]'].entries()) {
      await saveSession({
        workout,
        drafts: [{ ...d, sessionNote: note, sets: [{ ...done(20, 8), setNumber: 1 }] }],
        date: `2026-11-1${i}`,
        startedAt: T + i,
      });
    }
    expect((await draftFor('e1')).lastNote).toBeUndefined();
  });

  it('keeps a note written on an exercise with no sets, on the session', async () => {
    await db.exercises.add(ex('e1', 'לחיצת רגליים'));
    const d = await draftFor('e1');
    await saveSession({ workout, drafts: [{ ...d, sessionNote: 'המכונה תקולה' }], date: '2026-11-20', startedAt: T });
    expect(await db.exerciseLogs.count()).toBe(0);
    expect((await db.sessions.toArray())[0]!.notes).toBe('לחיצת רגליים: המכונה תקולה');
  });

  it('carries over what was typed into an old-format draft instead of dropping it', async () => {
    await db.exercises.add(ex('e1', 'סקוואט', { notes: 'עמידה רחבה' }));
    const d = await draftFor('e1');
    const { sessionNote: _s, ...legacy } = d;
    void _s;
    const [restored] = await reconcileDraftWithPlan('w1', [{ ...legacy, notes: 'כאב בברך' }]);
    expect(restored!.sessionNote).toBe('כאב בברך');
    expect(restored!.notes).toBe('עמידה רחבה');

    // And an old draft saved straight from the dashboard keeps it too.
    await saveSession({
      workout,
      drafts: [{ ...legacy, notes: 'כאב בברך', sets: [{ ...done(60, 5), setNumber: 1 }] }],
      date: '2026-11-21',
      startedAt: T,
    });
    expect((await db.exerciseLogs.toArray())[0]!.notes).toBe('כאב בברך');
  });
});

describe('drop sets', () => {
  it('are saved and add volume, but do not count as planned sets', async () => {
    await db.exercises.add(ex('e1', 'פשיטת מרפק', { targetSets: 2 }));
    const d = await draftFor('e1');
    const res = await saveSession({
      workout,
      drafts: [
        {
          ...d,
          sets: [
            { ...done(30, 8), setNumber: 1 },
            { ...done(30, 8), setNumber: 2 },
            { ...done(20, 10, { isDrop: true }), setNumber: 3 },
          ],
        },
      ],
      date: '2026-11-22',
      startedAt: T,
    });
    expect(res.session.completionPct).toBe(100);
    expect(res.session.totalVolume).toBe(30 * 8 * 2 + 20 * 10);
    const sets = await db.setLogs.toArray();
    expect(sets.filter((s) => s.isDrop)).toHaveLength(1);
  });

  it('are never read by progression or counted as completed sets', () => {
    const logs: SetLog[] = [
      { id: 'a', exerciseLogId: 'l', sessionId: 's', exerciseId: 'e', setNumber: 1, weight: 30, reps: 8, completed: true },
      { id: 'b', exerciseLogId: 'l', sessionId: 's', exerciseId: 'e', setNumber: 2, weight: 20, reps: 6, completed: true, isDrop: true },
    ];
    expect(pastSetsFromLogs(logs)).toEqual([{ weight: 30, reps: 8, completed: true }]);
    expect(statsForExercise('s', 'e', '2026-11-22', logs, 1).completedSets).toBe(1);
  });

  it('do not stop the next session from prescribing an increase', async () => {
    await db.exercises.add(ex('e1', 'פשיטת מרפק', { targetSets: 2 }));
    const d = await draftFor('e1');
    await saveSession({
      workout,
      drafts: [
        {
          ...d,
          sets: [
            { ...done(30, 8), setNumber: 1 },
            { ...done(30, 8), setNumber: 2 },
            { ...done(20, 5, { isDrop: true }), setNumber: 3 },
          ],
        },
      ],
      date: '2026-11-22',
      startedAt: T,
    });
    const next = await draftFor('e1');
    expect(next.prescription?.kind).toBe('increase');
    expect(next.sets.every((s) => !s.isDrop)).toBe(true);
  });
});

describe('supersets', () => {
  it('carry the pairing from the exercise into the next session', async () => {
    await db.exercises.bulkAdd([
      ex('a', 'לחיצת כתפיים', { order: 0, supersetGroup: 'ss1' }),
      ex('b', 'הרחקה', { order: 1, supersetGroup: 'ss1' }),
      ex('c', 'פשיטה', { order: 2 }),
    ]);
    const res = await buildDraftFromWorkout('w1');
    expect(res?.drafts.map((d) => d.supersetGroup)).toEqual(['ss1', 'ss1', undefined]);
  });
});

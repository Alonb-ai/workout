import { describe, expect, it } from 'vitest';
import { moveDraft, stepDraft } from './reorder';
import type { DraftExercise } from './types';

function ex(id: string, order: number, completed = false): DraftExercise {
  return {
    exerciseId: id,
    exerciseName: id,
    muscleGroupId: 'g',
    muscleGroupName: 'g',
    targetSets: 2,
    targetRepsMin: 8,
    targetRepsMax: 10,
    barWeight: 0,
    isMachine: false,
    defaultRestSec: 90,
    order,
    sets: [
      { setNumber: 1, weight: completed ? 40 : '', reps: completed ? 8 : '', completed },
      { setNumber: 2, weight: '', reps: '', completed: false },
    ],
  };
}

const ids = (ds: DraftExercise[]) => ds.map((d) => d.exerciseId);

describe('moveDraft', () => {
  const base = [ex('a', 0, true), ex('b', 1), ex('c', 2), ex('d', 3)];

  it('moves down and renumbers order', () => {
    const out = moveDraft(base, 0, 2);
    expect(ids(out)).toEqual(['b', 'c', 'a', 'd']);
    expect(out.map((d) => d.order)).toEqual([0, 1, 2, 3]);
  });

  it('moves up', () => {
    expect(ids(moveDraft(base, 3, 1))).toEqual(['a', 'd', 'b', 'c']);
  });

  it('keeps logged sets attached to their exercise', () => {
    const out = moveDraft(base, 0, 3);
    const a = out.find((d) => d.exerciseId === 'a')!;
    expect(a.sets[0]).toMatchObject({ weight: 40, reps: 8, completed: true });
  });

  it('is a no-op out of range or onto itself', () => {
    expect(moveDraft(base, 1, 1)).toBe(base);
    expect(moveDraft(base, 0, -1)).toBe(base);
    expect(moveDraft(base, 3, 4)).toBe(base);
  });

  it('does not mutate the input', () => {
    const copy = ids(base);
    moveDraft(base, 0, 3);
    expect(ids(base)).toEqual(copy);
  });
});

describe('stepDraft', () => {
  const base = [ex('a', 0), ex('b', 1), ex('c', 2)];
  it('steps up and down by id', () => {
    expect(ids(stepDraft(base, 'b', -1))).toEqual(['b', 'a', 'c']);
    expect(ids(stepDraft(base, 'b', 1))).toEqual(['a', 'c', 'b']);
  });
  it('ignores edges and unknown ids', () => {
    expect(stepDraft(base, 'a', -1)).toBe(base);
    expect(stepDraft(base, 'c', 1)).toBe(base);
    expect(stepDraft(base, 'zz', 1)).toBe(base);
  });
});

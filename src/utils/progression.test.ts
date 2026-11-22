import { describe, it, expect } from 'vitest';
import {
  prescribe,
  resolveIncrement,
  formatLastSets,
  formatSetReps,
  targetRepsForSet,
  type PastSet,
} from './progression';

const set = (weight: number, reps: number, completed = true): PastSet => ({ weight, reps, completed });

const base = { targetSets: 3, repsMin: 6, repsMax: 8, increment: 2.5 };

describe('resolveIncrement', () => {
  const inv = [
    { weight: 1.25, qty: 4 },
    { weight: 5, qty: 4 },
    { weight: 20, qty: 4 },
  ];

  it('prefers an explicit per-exercise override', () => {
    expect(resolveIncrement({ incrementKg: 5, isMachine: true, inventory: inv })).toBe(5);
  });

  it('uses 2.5 for machines with no override', () => {
    expect(resolveIncrement({ isMachine: true, inventory: inv })).toBe(2.5);
  });

  it('uses the smallest owned plate PAIR for barbells', () => {
    // 1.25 kg plates, loaded in pairs → 2.5 kg per step
    expect(resolveIncrement({ inventory: inv })).toBe(2.5);
  });

  it('ignores plates the user owns only one of', () => {
    expect(resolveIncrement({ inventory: [{ weight: 0.5, qty: 1 }, { weight: 2.5, qty: 2 }] })).toBe(5);
  });

  it('ignores a zero/negative override', () => {
    expect(resolveIncrement({ incrementKg: 0, isMachine: true, inventory: inv })).toBe(2.5);
  });
});

const one = (lastSets: PastSet[]) => ({ history: [lastSets] });

describe('prescribe — first session', () => {
  it('uses the seed weight when there is no history', () => {
    const p = prescribe({ ...base, history: [], seedWeight: 40 });
    expect(p.kind).toBe('first');
    expect(p.weight).toBe(40);
    expect(p.setReps).toEqual([6, 6, 6]);
  });

  it('snaps an off-grid seed weight onto the increment', () => {
    const p = prescribe({ ...base, history: [], seedWeight: 41 });
    expect(p.weight).toBe(40);
  });

  it('has nothing to prescribe when there is no seed either', () => {
    const p = prescribe({ ...base, history: [] });
    expect(p.kind).toBe('first');
    // weight 0 on a 'first' prescription is what tells the UI to leave the row
    // blank and keep ✓ disabled, rather than let one tap log a 0 kg set.
    expect(p.weight).toBe(0);
  });

  it('treats a session where nothing was completed as no history', () => {
    const p = prescribe({ ...base, ...one([set(50, 8, false), set(50, 8, false)]), seedWeight: 40 });
    expect(p.kind).toBe('first');
  });
});

describe('prescribe — per-set double progression', () => {
  const r810 = { targetSets: 3, repsMin: 8, repsMax: 10, increment: 2.5 };

  it('10,10,8 becomes 10,10,9 — not 8,8,8', () => {
    const p = prescribe({ ...r810, ...one([set(40, 10), set(40, 10), set(40, 8)]) });
    expect(p.kind).toBe('add-rep');
    expect(p.weight).toBe(40);
    expect(p.setReps).toEqual([10, 10, 9]);
  });

  it('asks for one more rep on every set below the top', () => {
    const p = prescribe({ ...base, ...one([set(40, 8), set(40, 7), set(40, 6)]) });
    expect(p.kind).toBe('add-rep');
    expect(p.setReps).toEqual([8, 8, 7]);
  });

  it('never jumps 3–4 reps to the top of the range', () => {
    const p = prescribe({ ...base, ...one([set(60, 4), set(60, 3), set(60, 3)]) });
    expect(p.weight).toBe(60);
    expect(p.setReps).toEqual([5, 4, 4]);
  });

  it('never asks for fewer reps than a set already did', () => {
    const p = prescribe({ ...r810, ...one([set(40, 12), set(40, 9), set(40, 8)]) });
    expect(p.setReps).toEqual([12, 10, 9]);
  });

  it('increases when every target set hit the top of the range', () => {
    const p = prescribe({ ...base, ...one([set(40, 8), set(40, 8), set(40, 8)]) });
    expect(p.kind).toBe('increase');
    expect(p.weight).toBe(42.5);
    expect(p.fromWeight).toBe(40);
  });

  it('sets post-increase reps from Epley, inside the range', () => {
    // 55×8 → 60: Epley says ~4.8, minus one → floored at 4, the bottom of the range.
    const squat = prescribe({ targetSets: 3, repsMin: 4, repsMax: 8, increment: 5, ...one([set(55, 8), set(55, 8), set(55, 8)]) });
    expect(squat.weight).toBe(60);
    expect(squat.setReps).toEqual([4, 4, 4]);
    // A small step barely costs reps: 80×10 → 82.5 ≈ 8.8 → 8, minus one → 7.
    const pull = prescribe({ targetSets: 3, repsMin: 6, repsMax: 10, increment: 2.5, ...one([set(80, 10), set(80, 10), set(80, 10)]) });
    expect(pull.setReps).toEqual([7, 7, 7]);
    // A big jump is floored at the bottom of the range, never below it.
    const big = prescribe({ targetSets: 3, repsMin: 6, repsMax: 10, increment: 3.75, ...one([set(21.25, 10), set(21.25, 10), set(21.25, 10)]) });
    expect(big.setReps).toEqual([6, 6, 6]);
  });

  it('does NOT increase when the weakest set fell short', () => {
    const p = prescribe({ ...base, ...one([set(40, 8), set(40, 8), set(40, 7)]) });
    expect(p.kind).toBe('add-rep');
    expect(p.weight).toBe(40);
    expect(p.setReps).toEqual([8, 8, 8]);
  });

  it('does NOT increase when a target set is missing — finish the sets first', () => {
    const p = prescribe({ ...base, ...one([set(40, 8), set(40, 8)]) });
    expect(p.kind).toBe('hold');
    expect(p.weight).toBe(40);
    expect(p.setReps).toEqual([8, 8, 8]);
  });

  it('pads a missing set with the weakest one, not with the top of the range', () => {
    const p = prescribe({ targetSets: 3, repsMin: 6, repsMax: 10, increment: 2.5, ...one([set(25, 9), set(25, 6)]) });
    expect(p.setReps).toEqual([10, 7, 7]);
  });

  it('ignores warm-up sets below the working weight', () => {
    const p = prescribe({ ...base, ...one([set(20, 10), set(40, 8), set(40, 8), set(40, 8)]) });
    expect(p.kind).toBe('increase');
    expect(p.weight).toBe(42.5);
  });

  it('does not treat one grinder below the range as the working weight', () => {
    // 22×3 was an attempt; the work was done at 18.
    const p = prescribe({ targetSets: 3, repsMin: 6, repsMax: 10, increment: 2, ...one([set(22, 3), set(18, 6), set(18, 6), set(18, 5)]) });
    expect(p.weight).toBe(18);
    expect(p.setReps).toEqual([7, 7, 6]);
  });

  it('ignores sets that were not completed', () => {
    const p = prescribe({ ...base, ...one([set(40, 8), set(40, 8), set(45, 1, false)]) });
    expect(p.weight).toBe(40);
  });

  it('keeps the increment grid clean with fractional plates', () => {
    const p = prescribe({ ...base, increment: 1.25, ...one([set(41.25, 8), set(41.25, 8), set(41.25, 8)]) });
    expect(p.weight).toBe(42.5);
  });
});

describe('prescribe — stuck', () => {
  const r810 = { targetSets: 3, repsMin: 8, repsMax: 10, increment: 2.5 };
  const s = (w: number, ...reps: number[]): PastSet[] => reps.map((r) => set(w, r));

  it('one rep from the top for 3 sessions → heavier with fewer reps, never a deload', () => {
    const p = prescribe({ ...r810, history: [s(50, 10, 9, 9), s(50, 9, 9, 9), s(50, 9, 9, 9)] });
    expect(p.kind).toBe('break');
    expect(p.weight).toBe(52.5);
    expect((p.setReps ?? []).every((r) => r >= 8 && r < 10)).toBe(true);
  });

  it('two stuck sessions are not enough to act', () => {
    const p = prescribe({ ...r810, history: [s(50, 9, 9, 9), s(50, 9, 9, 9)] });
    expect(p.kind).toBe('add-rep');
    expect(p.setReps).toEqual([10, 10, 10]);
  });

  it('progress inside the window is not "stuck"', () => {
    const p = prescribe({ ...r810, history: [s(50, 8, 8, 8), s(50, 9, 8, 8), s(50, 9, 9, 8)] });
    expect(p.kind).toBe('add-rep');
  });

  it('one bad day after a good session is not a plateau', () => {
    // 15×9s, then 15×10s, then a rough 8,8,7: still moving, keep chasing.
    const p = prescribe({ ...r810, repsMax: 12, history: [s(15, 9, 9, 9), s(15, 10, 10, 10), s(15, 8, 8, 7)] });
    expect(p.kind).toBe('add-rep');
    expect(p.weight).toBe(15);
    expect(p.setReps).toEqual([9, 9, 8]);
  });

  it('a single heavy set after lighter work does not set an unbeatable baseline', () => {
    // 50×6,6,6 + 55×6 → 55×4,4,4,4 → 55×5,5,5,6 is a lifter getting stronger at 55.
    const p = prescribe({
      targetSets: 4, repsMin: 4, repsMax: 8, increment: 2.5,
      history: [[set(50, 6), set(50, 6), set(50, 6), set(55, 6)], s(55, 4, 4, 4, 4), s(55, 5, 5, 5, 6)],
    });
    expect(p.kind).toBe('add-rep');
    expect(p.weight).toBe(55);
    expect(p.setReps).toEqual([6, 6, 6, 7]);
  });

  it('an off-grid dumbbell steps back to the nearest loadable weight, not a full step past it', () => {
    const p = prescribe({ ...r810, history: [s(8, 10, 10, 8), s(8, 10, 9, 8), s(8, 10, 8, 8)] });
    expect(p.kind).toBe('deload');
    expect(p.weight).toBe(7.5);
  });

  it('a weight change inside the window resets the count', () => {
    const p = prescribe({ ...r810, history: [s(47.5, 10, 10, 10), s(50, 8, 8, 8), s(50, 8, 8, 8)] });
    expect(p.kind).toBe('add-rep');
  });

  it('stuck mid-range steps back ONE increment, not 10%', () => {
    const p = prescribe({ ...base, repsMax: 10, history: [s(100, 7, 7, 6), s(100, 7, 6, 6), s(100, 7, 7, 6)] });
    expect(p.kind).toBe('deload');
    expect(p.weight).toBe(97.5);
    expect(p.setReps).toEqual([8, 8, 7]);
  });

  it('stuck below the range deloads ~10% to get back into it', () => {
    const p = prescribe({ ...base, history: [s(100, 5, 4, 4), s(100, 5, 4, 4), s(100, 4, 4, 4)] });
    expect(p.kind).toBe('deload');
    expect(p.weight).toBe(90);
    expect(p.setReps).toEqual([6, 6, 6]);
  });
});

describe('prescribe — bodyweight', () => {
  it('chases reps on bodyweight work instead of adding weight', () => {
    const p = prescribe({ ...base, ...one([set(0, 8), set(0, 8), set(0, 8)]) });
    expect(p.weight).toBe(0);
    expect(p.kind).toBe('hold');
    expect(p.setReps).toEqual([8, 8, 8]);
  });

  it('adds a rep per set to sub-max bodyweight work', () => {
    const p = prescribe({ ...base, ...one([set(0, 6), set(0, 5), set(0, 4)]) });
    expect(p.kind).toBe('add-rep');
    expect(p.setReps).toEqual([7, 6, 5]);
  });
});

describe('targets helpers', () => {
  it('formats uniform and mixed per-set targets', () => {
    expect(formatSetReps({ kind: 'add-rep', weight: 40, reps: 8, setReps: [8, 8, 8], fromWeight: 40 })).toBe('8');
    expect(formatSetReps({ kind: 'add-rep', weight: 40, reps: 10, setReps: [10, 10, 9], fromWeight: 40 })).toBe('10,10,9');
  });

  it('reads a pre-upgrade draft prescription with no per-set list', () => {
    const old = { kind: 'add-rep' as const, weight: 40, reps: 8, fromWeight: 40 };
    expect(targetRepsForSet(old, 2)).toBe(8);
    expect(formatSetReps(old)).toBe('8');
  });

  it('extra sets repeat the last target', () => {
    expect(targetRepsForSet({ kind: 'add-rep', weight: 40, reps: 10, setReps: [10, 9], fromWeight: 40 }, 4)).toBe(9);
  });
});

describe('formatLastSets', () => {
  it('groups reps under each weight, heaviest first', () => {
    expect(formatLastSets([set(20, 10), set(40, 8), set(40, 7)])).toBe('40×8,7 · 20×10');
  });

  it('drops incomplete and zero-rep sets', () => {
    expect(formatLastSets([set(40, 8), set(40, 0), set(40, 8, false)])).toBe('40×8');
  });

  it('returns an empty string with nothing completed', () => {
    expect(formatLastSets([set(40, 8, false)])).toBe('');
  });

  it('keeps fractional weights readable', () => {
    expect(formatLastSets([set(42.5, 8)])).toBe('42.5×8');
  });
});

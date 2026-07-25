import { describe, it, expect } from 'vitest';
import { prescribe, resolveIncrement, formatLastSets, type PastSet } from './progression';

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

describe('prescribe — first session', () => {
  it('uses the seed weight when there is no history', () => {
    const p = prescribe({ ...base, lastSets: [], seedWeight: 40 });
    expect(p.kind).toBe('first');
    expect(p.weight).toBe(40);
    expect(p.reps).toBe(6);
  });

  it('snaps an off-grid seed weight onto the increment', () => {
    const p = prescribe({ ...base, lastSets: [], seedWeight: 41 });
    expect(p.weight).toBe(40);
  });

  it('has nothing to prescribe when there is no seed either', () => {
    const p = prescribe({ ...base, lastSets: [] });
    expect(p.kind).toBe('first');
    // weight 0 on a 'first' prescription is what tells the UI to leave the row
    // blank and keep ✓ disabled, rather than let one tap log a 0 kg set.
    expect(p.weight).toBe(0);
  });

  it('treats a session where nothing was completed as no history', () => {
    const p = prescribe({ ...base, lastSets: [set(50, 8, false), set(50, 8, false)], seedWeight: 40 });
    expect(p.kind).toBe('first');
  });
});

describe('prescribe — double progression', () => {
  it('increases when every target set hit the top of the range', () => {
    const p = prescribe({ ...base, lastSets: [set(40, 8), set(40, 8), set(40, 8)] });
    expect(p.kind).toBe('increase');
    expect(p.weight).toBe(42.5);
    expect(p.reps).toBe(6);
  });

  it('does NOT increase when the weakest set fell short', () => {
    const p = prescribe({ ...base, lastSets: [set(40, 8), set(40, 8), set(40, 7)] });
    expect(p.kind).toBe('add-rep');
    expect(p.weight).toBe(40);
    expect(p.reps).toBe(8);
  });

  it('does NOT increase when a target set is missing entirely', () => {
    const p = prescribe({ ...base, lastSets: [set(40, 8), set(40, 8)] });
    expect(p.kind).toBe('hold');
    expect(p.weight).toBe(40);
    expect(p.reps).toBe(8);
  });

  it('asks for one more rep when mid-range', () => {
    const p = prescribe({ ...base, lastSets: [set(40, 6), set(40, 6), set(40, 6)] });
    expect(p.kind).toBe('add-rep');
    expect(p.reps).toBe(7);
  });

  it('never prescribes more reps than the top of the range', () => {
    const p = prescribe({ ...base, lastSets: [set(40, 8), set(40, 8), set(40, 9)] });
    // weakest at top weight is 8 → already at max → increase
    expect(p.kind).toBe('increase');
    expect(p.reps).toBe(6);
  });

  it('ignores warm-up sets below the top weight', () => {
    const p = prescribe({ ...base, lastSets: [set(20, 10), set(40, 8), set(40, 8), set(40, 8)] });
    expect(p.kind).toBe('increase');
    expect(p.weight).toBe(42.5);
  });

  it('ignores sets that were not completed', () => {
    const p = prescribe({ ...base, lastSets: [set(40, 8), set(40, 8), set(45, 1, false)] });
    expect(p.weight).toBe(40);
    expect(p.kind).toBe('hold');
  });

  it('keeps the increment grid clean with fractional plates', () => {
    const p = prescribe({
      ...base,
      increment: 1.25,
      lastSets: [set(41.25, 8), set(41.25, 8), set(41.25, 8)],
    });
    expect(p.weight).toBe(42.5);
  });
});

describe('prescribe — stalls and bodyweight', () => {
  it('deloads a stalled lift instead of holding', () => {
    const p = prescribe({
      ...base,
      lastSets: [set(100, 6), set(100, 6), set(100, 6)],
      isStalled: true,
    });
    expect(p.kind).toBe('deload');
    expect(p.weight).toBe(90);
    expect(p.weight).toBeLessThan(100);
  });

  it('still increases a stalled lift that actually earned it', () => {
    const p = prescribe({
      ...base,
      lastSets: [set(100, 8), set(100, 8), set(100, 8)],
      isStalled: true,
    });
    expect(p.kind).toBe('increase');
  });

  it('falls back to reps when a deload would not lower the weight', () => {
    const p = prescribe({ ...base, increment: 2.5, lastSets: [set(2.5, 6), set(2.5, 6), set(2.5, 6)], isStalled: true });
    expect(p.kind).not.toBe('deload');
  });

  it('chases reps on bodyweight work instead of adding weight', () => {
    const p = prescribe({ ...base, lastSets: [set(0, 8), set(0, 8), set(0, 8)] });
    expect(p.weight).toBe(0);
    expect(p.kind).toBe('hold');
    expect(p.reps).toBe(8);
  });

  it('adds a rep to sub-max bodyweight work', () => {
    const p = prescribe({ ...base, lastSets: [set(0, 6), set(0, 6), set(0, 6)] });
    expect(p.kind).toBe('add-rep');
    expect(p.reps).toBe(7);
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

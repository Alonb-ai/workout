import { describe, expect, it } from 'vitest';
import { warmupSets } from './warmup';

describe('warmupSets', () => {
  it('ramps a barbell lift from the empty bar, percentages of the total load', () => {
    // 60 net + 20 bar = 80 total → 32 / 48 / 64 total → 12 / 28 / 44 net, floored to 2.5.
    expect(warmupSets({ workWeight: 60, barWeight: 20, isMachine: false, increment: 2.5 })).toEqual([
      { weight: 0, reps: 10 },
      { weight: 10, reps: 8 },
      { weight: 27.5, reps: 5 },
      { weight: 42.5, reps: 3 },
    ]);
  });

  it('never reaches or passes the working weight, and every set climbs', () => {
    const sets = warmupSets({ workWeight: 10, barWeight: 20, isMachine: false, increment: 2.5 });
    // 30 total → 12/18/24 → net -8/-2/4 → only the bar and 2.5.
    expect(sets).toEqual([
      { weight: 0, reps: 10 },
      { weight: 2.5, reps: 3 },
    ]);
    for (let i = 1; i < sets.length; i++) expect(sets[i]!.weight).toBeGreaterThan(sets[i - 1]!.weight);
  });

  it('uses two feeler sets on a machine', () => {
    expect(warmupSets({ workWeight: 50, barWeight: 0, isMachine: true, increment: 5 })).toEqual([
      { weight: 25, reps: 10 },
      { weight: 35, reps: 5 },
    ]);
  });

  it('treats a machine with a bar weight set as a machine (bar ignored)', () => {
    expect(warmupSets({ workWeight: 40, barWeight: 20, isMachine: true, increment: 2.5 })).toEqual([
      { weight: 20, reps: 10 },
      { weight: 30, reps: 5 },
    ]);
  });

  it('skips the ramp for light non-barbell work and for bodyweight', () => {
    expect(warmupSets({ workWeight: 8, barWeight: 0, isMachine: false, increment: 1 })).toEqual([]);
    expect(warmupSets({ workWeight: 0, barWeight: 20, isMachine: false, increment: 2.5 })).toEqual([]);
  });

  it('floors to the loading step so nothing overshoots', () => {
    const sets = warmupSets({ workWeight: 22, barWeight: 0, isMachine: false, increment: 2 });
    expect(sets).toEqual([
      { weight: 10, reps: 10 },
      { weight: 16, reps: 5 },
    ]);
  });
});

/**
 * Smoke tests for core math (scoring, plate calc, stall detection).
 * Run with: npx tsx scripts/smoke.ts
 * Exits non-zero if any assertion fails.
 */
import {
  epley1RM,
  totalVolume,
  topWeight,
  computeWorkoutScore,
  compareToPrevious,
  statsForExercise,
} from '../src/utils/scoring.ts';
import { computePlateLayout } from '../src/utils/plateMath.ts';
import { detectStall, deloadWeight } from '../src/utils/stall.ts';
import type { SetLog, ExerciseSessionStats } from '../src/types/index.ts';

let pass = 0;
let fail = 0;

function eq<T>(actual: T, expected: T, label: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`);
  }
}

function near(actual: number, expected: number, eps: number, label: string) {
  const ok = Math.abs(actual - expected) <= eps;
  if (ok) {
    pass++;
    console.log(`  ✓ ${label} (${actual} ≈ ${expected})`);
  } else {
    fail++;
    console.log(`  ✗ ${label}\n      expected: ~${expected} (±${eps})\n      actual:   ${actual}`);
  }
}

function mkSet(n: number, w: number, r: number, completed = true): SetLog {
  return {
    id: `s${n}`,
    exerciseLogId: 'el',
    sessionId: 'sess',
    exerciseId: 'ex',
    setNumber: n,
    weight: w,
    reps: r,
    completed,
  };
}

// ---------- Scoring ----------
console.log('\n[Scoring]');
near(epley1RM(100, 5), 100 * (1 + 5 / 30), 0.001, 'Epley 100×5 = 116.67');
near(epley1RM(80, 10), 80 * (1 + 10 / 30), 0.001, 'Epley 80×10 ≈ 106.67');
eq(epley1RM(0, 5), 0, 'Epley 0 weight = 0');
eq(epley1RM(100, 0), 0, 'Epley 0 reps = 0');

const sets = [mkSet(1, 100, 5), mkSet(2, 100, 5), mkSet(3, 90, 6)];
eq(totalVolume(sets), 100 * 5 + 100 * 5 + 90 * 6, 'volume = 1540');
eq(topWeight(sets), 100, 'topWeight = 100');

// Skip incomplete set
const setsWithSkipped = [mkSet(1, 100, 5), mkSet(2, 100, 5, false)];
eq(totalVolume(setsWithSkipped), 500, 'volume ignores incomplete sets');

// Workout score scenarios
const score1 = computeWorkoutScore({
  currentVolume: 1500,
  prevVolumes: [1500, 1500, 1500],
  prCount: 0,
  plannedSets: 12,
  completedSets: 12,
});
eq(score1.score, Math.round(70 * 0.5 + 0 * 0.25 + 100 * 0.25), 'score: even volume, no PR, full completion');

const score2 = computeWorkoutScore({
  currentVolume: 1800,
  prevVolumes: [1500, 1500, 1500],
  prCount: 2,
  plannedSets: 12,
  completedSets: 12,
});
// ratio 1.2 -> linear above 1.0: 70 + (0.2/0.5)*30 = 82
// 0.5 * 82 + 0.25 * 85 + 0.25 * 100 = 41 + 21.25 + 25 = 87.25 -> 87
eq(score2.score, 87, 'score: +20% volume, 2 PRs, full completion ≈ 87');

const score3 = computeWorkoutScore({
  currentVolume: 1000,
  prevVolumes: [],
  prCount: 0,
  plannedSets: 12,
  completedSets: 8,
});
// no prev → 70; completion 8/12 = 66.67%; PR 0
// 0.5*70 + 0.25*0 + 0.25*66.67 = 35 + 0 + 16.67 = 51.67 → 52
near(score3.score, 52, 1, 'score: first-time workout, 8/12 complete ≈ 52');

// PR detection
const allPrev: ExerciseSessionStats[] = [
  { exerciseId: 'e1', sessionId: 'a', date: '2026-05-10', topWeight: 100, topReps: 5, volume: 1500, est1RM: 116.6, completedSets: 3, plannedSets: 3 },
  { exerciseId: 'e1', sessionId: 'b', date: '2026-05-13', topWeight: 100, topReps: 5, volume: 1500, est1RM: 116.6, completedSets: 3, plannedSets: 3 },
];
const current: ExerciseSessionStats = {
  exerciseId: 'e1',
  sessionId: 'c',
  date: '2026-05-16',
  topWeight: 105,
  topReps: 5,
  volume: 1575,
  est1RM: 122.5,
  completedSets: 3,
  plannedSets: 3,
};
const tag = compareToPrevious(current, allPrev[1] ?? null, allPrev);
eq(tag.kind, 'pr', 'PR tag when top weight increases');

const tagSame = compareToPrevious(allPrev[1] ?? current, allPrev[0] ?? null, [allPrev[0] ?? current]);
eq(tagSame.kind, 'same', 'same tag when no change');

// statsForExercise
const stats = statsForExercise('s', 'ex', '2026-05-21', sets, 3);
eq(stats.topWeight, 100, 'stats topWeight');
eq(stats.topReps, 5, 'stats topReps for topWeight');
eq(stats.volume, 1540, 'stats volume');
eq(stats.completedSets, 3, 'stats completedSets');
eq(stats.plannedSets, 3, 'stats plannedSets');

// ---------- Plate math ----------
console.log('\n[Plate math]');
const plates = [
  { weight: 20, qty: 4 },
  { weight: 15, qty: 2 },
  { weight: 10, qty: 4 },
  { weight: 5, qty: 4 },
  { weight: 2.5, qty: 4 },
  { weight: 1.25, qty: 4 },
];

// 100 kg net on 20 kg bar → 50 per side → 20+20+5+2.5+2.5 = 50
const r1 = computePlateLayout({ requestedNet: 100, barWeight: 20, inventory: plates });
eq(r1.exact, true, '100 net is exact');
near(r1.perSideNet, 50, 0.001, 'per side = 50');
near(r1.achievedTotal, 120, 0.001, 'achieved total = 120 (with bar)');
eq(r1.perSide.length >= 1, true, 'at least one plate per side');
// verify they sum to 50 per side
const sum50 = r1.perSide.reduce((a, b) => a + b, 0);
near(sum50, 50, 0.001, 'plates sum to 50 per side');

// 81 kg net with these plates: 40.5 per side. The smallest pair available is 1.25 (2.5 across both sides).
// 81 / 2.5 (pair increment) = 32.4 — not exact. Closest pair-loadable is 80 or 82.5.
const r2 = computePlateLayout({ requestedNet: 81, barWeight: 20, inventory: plates });
eq(r2.exact, false, '81 kg net is NOT exact');
// achievedNet should be 80
near(r2.perSideNet * 2, 80, 0.001, 'closest achievable net = 80');
near(r2.remainderNet, -1, 0.001, 'remainder = -1 (under)');

// Machine
const r3 = computePlateLayout({ requestedNet: 80, barWeight: 0, inventory: plates, isMachine: true });
eq(r3.machine, true, 'machine flag');
eq(r3.perSide.length, 0, 'no plates for machine');
near(r3.achievedTotal, 80, 0.001, 'machine net = 80');

// Bar only request 0
const r4 = computePlateLayout({ requestedNet: 0, barWeight: 20, inventory: plates });
eq(r4.exact, true, '0 net exact');
eq(r4.perSide.length, 0, 'no plates for 0 net');

// Insufficient inventory: 100 kg with only 1 pair of 10 → can only load 20 total
const r5 = computePlateLayout({
  requestedNet: 100,
  barWeight: 20,
  inventory: [{ weight: 10, qty: 2 }],
});
near(r5.perSideNet * 2, 20, 0.001, 'with only one 10kg pair, max 20 net');

// ---------- Stall detection ----------
console.log('\n[Stall]');
const makeStat = (id: string, top: number, vol: number): ExerciseSessionStats => ({
  exerciseId: 'x',
  sessionId: id,
  date: '2026-05-' + id,
  topWeight: top,
  topReps: 5,
  volume: vol,
  est1RM: 0,
  completedSets: 3,
  plannedSets: 3,
});

// flat = stall
eq(
  detectStall(
    [makeStat('01', 100, 1500), makeStat('02', 100, 1500), makeStat('03', 100, 1500)],
    'Bench',
  )?.exerciseName,
  'Bench',
  'stall detected on 3 flat sessions',
);

// improving = no stall
eq(
  detectStall(
    [makeStat('01', 100, 1500), makeStat('02', 102.5, 1550), makeStat('03', 105, 1600)],
    'Bench',
  ),
  null,
  'no stall when improving',
);

// < 3 sessions
eq(
  detectStall([makeStat('01', 100, 1500), makeStat('02', 100, 1500)], 'Bench'),
  null,
  'no stall flag with < 3 sessions',
);

// deload weight: 100 → 90 → rounded to 90 with 2.5 increment
eq(deloadWeight(100, 2.5), 90, 'deload 100 → 90');
eq(deloadWeight(105, 2.5), Math.round(94.5 / 2.5) * 2.5, 'deload 105 with 2.5 increment');

console.log(`\nResults: ${pass} passed, ${fail} failed.`);
process.exit(fail === 0 ? 0 : 1);

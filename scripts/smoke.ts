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
import { computeProgressionRate, suggestDeload, findSubstitutes } from '../src/utils/insights.ts';
import {
  matchStrengthLift,
  assessStrength,
  computeFFMI,
  categorizeBodyFat,
  standardsForSex,
} from '../src/utils/benchmarks.ts';
import type { SetLog, ExerciseSessionStats, Exercise } from '../src/types/index.ts';

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

console.log('\n[Insights]');

// Progression rate: from 100 to 110 over 60 days = 5 kg / month
{
  const a: ExerciseSessionStats = makeStat('a', 100, 1000);
  a.date = '2026-01-01';
  const b: ExerciseSessionStats = makeStat('b', 110, 1100);
  b.date = '2026-03-02'; // exactly 60 days later
  const p = computeProgressionRate([a, b]);
  eq(p?.kgPerMonth, 5, 'progression rate 5 kg / month');
  eq(p?.pctPerMonth, 5, 'progression rate 5% / month');
  eq(p?.sampleSize, 2, 'progression sample size');
}

// Progression rate: < 2 samples → null
eq(computeProgressionRate([makeStat('a', 100, 1000)]), null, 'progression null with 1 sample');

// Progression rate: span too short → null
{
  const a: ExerciseSessionStats = makeStat('a', 100, 1000);
  a.date = '2026-01-01';
  const b: ExerciseSessionStats = makeStat('b', 110, 1100);
  b.date = '2026-01-02';
  eq(computeProgressionRate([a, b]), null, 'progression null with 1-day span');
}

// Deload suggestion: 100kg → 90kg
{
  const flat = [makeStat('1', 100, 1000), makeStat('2', 100, 1000), makeStat('3', 100, 1000)];
  const d = suggestDeload(flat, 2.5);
  eq(d?.fromKg, 100, 'deload from 100');
  eq(d?.toKg, 90, 'deload to 90');
  eq(d?.pct, 10, 'deload pct 10');
}

// Deload suggestion: too few sessions → null
eq(suggestDeload([makeStat('1', 100, 1000)]), null, 'deload null with 1 session');

// Find substitutes: same muscle group only, exclude source
{
  const t = Date.now();
  const ex = (id: string, mg: string, name: string): Exercise => ({
    id,
    muscleGroupId: mg,
    name,
    targetSets: 3,
    targetRepsMin: 6,
    targetRepsMax: 8,
    defaultRestSec: 120,
    barWeight: 0,
    order: 0,
    createdAt: t,
    updatedAt: t,
  });
  const all = [
    ex('a', 'mg1', 'Bench Press'),
    ex('b', 'mg1', 'Incline Press'),
    ex('c', 'mg1', 'DB Press'),
    ex('d', 'mg2', 'Squat'),
  ];
  const subs = findSubstitutes('a', all, 5);
  eq(subs.map((s) => s.id), ['b', 'c'], 'subs limited to same muscle group');
  eq(findSubstitutes('a', all, 1).length, 1, 'subs respect limit');
  eq(findSubstitutes('missing', all).length, 0, 'subs empty for unknown id');
}

console.log('\n[Benchmarks — strength]');

eq(matchStrengthLift('Barbell Bench Press'), 'bench', 'match bench from full name');
eq(matchStrengthLift('Incline DB Bench'), 'bench', 'match bench from variant');
eq(matchStrengthLift('Back Squat'), 'squat', 'match squat');
eq(matchStrengthLift('Romanian Deadlift'), 'deadlift', 'match deadlift');
eq(matchStrengthLift('Overhead Press'), 'ohp', 'match ohp');
eq(matchStrengthLift('Lateral Raise'), null, 'no match for non-big lift');

// Male, BW=80kg, bench 1RM=100kg → ratio 1.25 → intermediate exactly
{
  const a = assessStrength('bench', 100, 80, 'male');
  eq(a?.level, 'intermediate', 'bench 1.25× = intermediate');
  eq(a?.nextLevel, 'advanced', 'bench next = advanced');
  eq(a?.nextLevelKg, 120, 'bench next kg = 120');
}

// Sub-beginner case: bench 50kg @ 80kg BW = 0.625× → still beginner
{
  const a = assessStrength('bench', 50, 80, 'male');
  eq(a?.level, 'beginner', 'sub-threshold defaults to beginner');
}

// Elite: bench 140 @ 80 = 1.75× exactly → elite, no next level
{
  const a = assessStrength('bench', 140, 80, 'male');
  eq(a?.level, 'elite', 'bench 1.75× = elite');
  eq(a?.nextLevel, null, 'elite has no next');
  eq(a?.nextLevelKg, null, 'elite has no next kg');
}

// Female standards are 65% of male
{
  const f = standardsForSex('female');
  const m = standardsForSex('male');
  eq(f.bench.intermediate, Math.round(m.bench.intermediate * 0.65 * 100) / 100,
    'female bench intermediate ≈ male × 0.65');
}

// Bad input returns null
eq(assessStrength('bench', 0, 80, 'male'), null, 'zero 1RM → null');
eq(assessStrength('bench', 100, 0, 'male'), null, 'zero bodyweight → null');

console.log('\n[Benchmarks — FFMI]');

// 80kg @ 15% fat @ 180cm male
{
  const r = computeFFMI(80, 15, 180, 'male');
  // lean = 68, height² = 3.24, raw = 68/3.24 ≈ 20.99
  // normalized = 20.99 + 6.1 × (1.8 - 1.8) = 20.99 → "above-average"
  eq(r?.leanMass, 68, 'lean mass = 80 × (1 - 0.15)');
  eq(r !== null && r.raw >= 20 && r.raw <= 22, true, 'raw FFMI in 20-22 range');
  eq(r?.category, 'above-average', 'FFMI 21 = above-average');
}

// Out of range → null
eq(computeFFMI(80, 70, 180), null, 'fat>60% rejected');
eq(computeFFMI(80, 15, 100), null, 'height<120 rejected');

console.log('\n[Benchmarks — body fat]');

eq(categorizeBodyFat(10, 'male'), 'athlete', 'male 10% = athlete');
eq(categorizeBodyFat(16, 'male'), 'fit', 'male 16% = fit');
eq(categorizeBodyFat(22, 'male'), 'average', 'male 22% = average');
eq(categorizeBodyFat(30, 'male'), 'high', 'male 30% = high');
eq(categorizeBodyFat(18, 'female'), 'athlete', 'female 18% = athlete');
eq(categorizeBodyFat(28, 'female'), 'average', 'female 28% = average');

console.log(`\nResults: ${pass} passed, ${fail} failed.`);
process.exit(fail === 0 ? 0 : 1);

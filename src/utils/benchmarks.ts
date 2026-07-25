import type { BodyProfile } from '@/types';

/**
 * Benchmarks: how the user stacks up against published reference data.
 *
 * Sources / methodology:
 *   - Strength standards: simplified bodyweight multipliers commonly cited
 *     by Lyle McDonald / Greg Nuckols / ExRx for the big lifts. The exact
 *     numbers vary across sources; this table uses round, defensible values
 *     and degrades gracefully when the user's data is incomplete (no
 *     bodyweight → no standard, female + no sex on profile → assume male
 *     with a disclaimer).
 *   - FFMI: Kouri-normalized (height-adjusted) Fat-Free Mass Index. Useful
 *     for natural-vs-enhanced ceiling chatter but treated here purely as a
 *     reference point, not a verdict.
 *   - Body fat %: ACSM-style descriptive ranges.
 *
 * Everything in this file is pure, runs against in-memory data, and is
 * covered by smoke tests in `scripts/smoke.ts`.
 */

export type StrengthLift = 'bench' | 'squat' | 'deadlift' | 'ohp';

export type StrengthLevel =
  | 'beginner'
  | 'novice'
  | 'intermediate'
  | 'advanced'
  | 'elite';

export const STRENGTH_LEVEL_LABELS: Record<StrengthLevel, string> = {
  beginner: 'מתחיל',
  novice: 'מתחיל-בינוני',
  intermediate: 'בינוני',
  advanced: 'מתקדם',
  elite: 'עילית',
};

/** Multipliers (1RM / bodyweight) per lift, per level, for males. */
const MALE_STANDARDS: Record<StrengthLift, Record<StrengthLevel, number>> = {
  bench: { beginner: 0.75, novice: 1.0, intermediate: 1.25, advanced: 1.5, elite: 1.75 },
  squat: { beginner: 1.0, novice: 1.5, intermediate: 2.0, advanced: 2.5, elite: 3.0 },
  deadlift: { beginner: 1.25, novice: 1.75, intermediate: 2.25, advanced: 2.75, elite: 3.25 },
  ohp: { beginner: 0.55, novice: 0.75, intermediate: 0.95, advanced: 1.15, elite: 1.35 },
};

/** Females cap at ~65% of male multipliers across the board (rough but standard). */
const FEMALE_RATIO = 0.65;

export function standardsForSex(
  sex: 'male' | 'female',
): Record<StrengthLift, Record<StrengthLevel, number>> {
  if (sex === 'male') return MALE_STANDARDS;
  const out: Record<StrengthLift, Record<StrengthLevel, number>> = {
    bench: { beginner: 0, novice: 0, intermediate: 0, advanced: 0, elite: 0 },
    squat: { beginner: 0, novice: 0, intermediate: 0, advanced: 0, elite: 0 },
    deadlift: { beginner: 0, novice: 0, intermediate: 0, advanced: 0, elite: 0 },
    ohp: { beginner: 0, novice: 0, intermediate: 0, advanced: 0, elite: 0 },
  };
  for (const lift of Object.keys(MALE_STANDARDS) as StrengthLift[]) {
    for (const lvl of Object.keys(MALE_STANDARDS[lift]) as StrengthLevel[]) {
      out[lift][lvl] = round2(MALE_STANDARDS[lift][lvl] * FEMALE_RATIO);
    }
  }
  return out;
}

/**
 * Heuristic substring match from a free-form exercise name to a standard key.
 * Variant qualifiers disqualify the name: a machine stack weight or a per-hand
 * dumbbell weight is meaningless against free-weight barbell standards.
 * ponytail: name-based only — rename a machine without one of these words and it
 * will be graded as the barbell lift. Pass Exercise.isMachine in if that happens.
 */
export function matchStrengthLift(exerciseName: string): StrengthLift | null {
  const n = exerciseName.toLowerCase();
  if (/machine|cable|smith|dumbbell|\bdb\b|incline|decline|close.grip/.test(n)) return null;
  if (/bench/.test(n)) return 'bench';
  if (/squat/.test(n)) return 'squat';
  if (/deadlift/.test(n)) return 'deadlift';
  if (/overhead.*press|military.*press|\bohp\b/.test(n)) return 'ohp';
  return null;
}

export interface StrengthAssessment {
  lift: StrengthLift;
  oneRm: number;
  bodyWeight: number;
  ratio: number;
  /** Current level threshold the user has already cleared. */
  level: StrengthLevel;
  /** The next level up (null if already elite). */
  nextLevel: StrengthLevel | null;
  /** kg required at this BW to hit the next level. */
  nextLevelKg: number | null;
  /** Whether the assessment used female standards. */
  sex: 'male' | 'female';
}

export function assessStrength(
  lift: StrengthLift,
  oneRm: number,
  bodyWeight: number,
  sex: 'male' | 'female' = 'male',
): StrengthAssessment | null {
  if (oneRm <= 0 || bodyWeight <= 0) return null;
  const table = standardsForSex(sex)[lift];
  const ratio = oneRm / bodyWeight;
  const levels: StrengthLevel[] = ['beginner', 'novice', 'intermediate', 'advanced', 'elite'];
  let current: StrengthLevel = 'beginner';
  for (const lvl of levels) {
    if (ratio >= table[lvl]) current = lvl;
  }
  // Next target is the lowest threshold NOT yet cleared, so someone below the
  // beginner bar is pointed at the beginner bar and not at novice.
  const next = levels.find((lvl) => ratio < table[lvl]) ?? null;
  return {
    lift,
    oneRm,
    bodyWeight,
    ratio: round2(ratio),
    level: current,
    nextLevel: next,
    nextLevelKg: next ? round1(table[next] * bodyWeight) : null,
    sex,
  };
}

/**
 * FFMI (Fat-Free Mass Index), height-normalized per Kouri et al.
 * Lean mass = bodyWeight × (1 - fatPct/100)
 * FFMI = lean / height² + 6.1 × (1.8 - height)
 * Returns null if any input is missing or out of physiological range.
 */
export interface FFMIResult {
  raw: number;
  normalized: number;
  leanMass: number;
  category: 'low' | 'average' | 'above-average' | 'high' | 'very-high';
}

export function computeFFMI(
  bodyWeightKg: number,
  fatPct: number,
  heightCm: number,
  sex: 'male' | 'female' = 'male',
): FFMIResult | null {
  if (bodyWeightKg <= 0 || fatPct < 0 || fatPct > 60 || heightCm < 120 || heightCm > 230) return null;
  const heightM = heightCm / 100;
  const leanMass = bodyWeightKg * (1 - fatPct / 100);
  const raw = leanMass / (heightM * heightM);
  const normalized = raw + 6.1 * (1.8 - heightM);
  // Categories are calibrated for males; females shift the breakpoints down by ~3.
  const offset = sex === 'female' ? 3 : 0;
  const n = normalized;
  let category: FFMIResult['category'];
  if (n < 18 - offset) category = 'low';
  else if (n < 20 - offset) category = 'average';
  else if (n < 22 - offset) category = 'above-average';
  else if (n < 25 - offset) category = 'high';
  else category = 'very-high';
  return {
    raw: round1(raw),
    normalized: round1(normalized),
    leanMass: round1(leanMass),
    category,
  };
}

export const FFMI_CATEGORY_LABEL: Record<FFMIResult['category'], string> = {
  low: 'מתחת לממוצע',
  average: 'ממוצע',
  'above-average': 'מעל הממוצע',
  high: 'גבוה (מתאמן מנוסה)',
  'very-high': 'גבוה מאוד',
};

/**
 * ACSM-style body-fat category by sex.
 * (Approximations — the "exact" ranges shift by age/decade in the ACSM
 * tables, but the descriptors here are usable defaults.)
 */
export type BodyFatCategory =
  | 'essential'
  | 'athlete'
  | 'fit'
  | 'average'
  | 'high';

export const BODY_FAT_CATEGORY_LABEL: Record<BodyFatCategory, string> = {
  essential: 'חיוני',
  athlete: 'אתלט',
  fit: 'כושר',
  average: 'ממוצע',
  high: 'גבוה',
};

export function categorizeBodyFat(fatPct: number, sex: 'male' | 'female' = 'male'): BodyFatCategory {
  if (sex === 'female') {
    if (fatPct < 14) return 'essential';
    if (fatPct < 21) return 'athlete';
    if (fatPct < 25) return 'fit';
    if (fatPct < 32) return 'average';
    return 'high';
  }
  // male
  if (fatPct < 6) return 'essential';
  if (fatPct < 14) return 'athlete';
  if (fatPct < 18) return 'fit';
  if (fatPct < 25) return 'average';
  return 'high';
}

/**
 * The set of profile fields actually needed for benchmarking. The body page
 * uses this to decide whether to prompt for missing data.
 */
export function isProfileComplete(profile: BodyProfile | undefined): boolean {
  return !!profile?.sex && !!profile?.heightCm;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

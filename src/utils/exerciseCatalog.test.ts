import { describe, it, expect } from 'vitest';
import { EXERCISE_CATALOG, inferMuscles, rankSimilar, sameExerciseName } from './exerciseCatalog';

describe('inferMuscles — names from the real program', () => {
  const cases: [string, string][] = [
    ['בנץ׳', 'chest'],
    ['לחיצת חזה בשיפוע דמבל', 'chest'],
    ['לחיצת כתפיים במכונה', 'frontDelts'],
    ['כתף צידית הנפה בכבלים', 'sideDelts'],
    ['כתפיים לצד בשיפוע עם דמבל', 'sideDelts'],
    ['יד אחורית מעבר לראש בכבלים', 'triceps'],
    ['סקוואט', 'quads'],
    ['לחיצת רגליים במכונה', 'quads'],
    ['פולי עליון', 'lats'],
    ['מתח', 'lats'],
    ['חתירה במכונה לשכמות', 'upperBack'],
    ['האמסטרינג בשכיבה במכונה', 'hamstrings'],
    ['RDL עם דמבלים', 'hamstrings'],
    ['Cable Standing Leg Curl', 'hamstrings'],
    ['יד קדמית בכבלים', 'biceps'],
    ['יד קדמית במכונה בריכיאליס', 'biceps'],
    ['בטן במכונה', 'abs'],
    ['פנגווין בעמידה', 'abs'],
    ['מכונת האק סקוואט', 'quads'],
    ['גב תחתון אקסטנשן עם פלטה', 'lowerBack'],
    ['שוקיים בישיבה במכונה', 'calves'],
    ['משיכת כבל לכיוון הפנים', 'rearDelts'],
    ['הנפות רגליים בתלייה', 'abs'],
  ];
  it.each(cases)('%s → %s', (name, primary) => {
    expect(inferMuscles({ name })[0]).toBe(primary);
  });

  it('falls back to the muscle-group label when the name says nothing', () => {
    expect(inferMuscles({ name: 'מכונה 3', groupName: 'חזה' })[0]).toBe('chest');
  });

  it('a manual override wins', () => {
    expect(inferMuscles({ name: 'בנץ׳', muscles: ['triceps'] })).toEqual(['triceps']);
  });

  it('a lower-back exercise is not also tagged as lats', () => {
    expect(inferMuscles({ name: 'גב תחתון אקסטנשן' })).not.toContain('lats');
  });
});

describe('rankSimilar', () => {
  const pool = ['פולי עליון', 'חתירה במכונה', 'סקוואט', 'יד קדמית בכבלים', 'פולי עליון אחיזה צרה'];
  it('puts same-primary-muscle exercises first and drops unrelated ones', () => {
    const r = rankSimilar({ name: 'מתח' }, pool, (n) => ({ name: n })).map((c) => c.item);
    expect(r[0]).toMatch(/פולי/);
    expect(r).not.toContain('סקוואט');
  });

  it('every catalog entry has muscles and a sane rep range', () => {
    for (const c of EXERCISE_CATALOG) {
      expect(c.muscles.length).toBeGreaterThan(0);
      expect(c.repsMin).toBeLessThanOrEqual(c.repsMax);
    }
  });
});

it('sameExerciseName ignores case, geresh and spacing', () => {
  expect(sameExerciseName('בנץ׳', 'בנץ')).toBe(true);
  expect(sameExerciseName(' Lat  Pulldown', 'lat pulldown')).toBe(true);
  expect(sameExerciseName('מתח', 'מתח רחב')).toBe(false);
});

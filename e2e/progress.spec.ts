import { test, expect, type Page } from '@playwright/test';
import {
  BENCH,
  openWorkout,
  logSet,
  finishAndSave,
  failOnConsoleErrors,
} from './helpers';

/**
 * Everything that reads history back: the per-exercise history page, the
 * journal, and the session detail editor. A wrong number here is the cheapest
 * thing in the app to ship and the most expensive to notice — the owner will
 * believe whatever the journal tells him about last month.
 */

const INCLINE = 'Incline DB Press';

/** Index of each UA card's chart icon, in on-screen order. */
const HISTORY_ICON: Record<string, number> = {
  [BENCH]: 0,
  [INCLINE]: 1,
  'Overhead Press': 2,
  'Lateral Raise': 3,
};

const pad = (n: number) => String(n).padStart(2, '0');
/** yyyy-MM-dd, N days before today, in local time (never UTC — that shifts a day). */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Open the per-exercise history page via the chart icon in the card header. */
async function openExerciseHistory(page: Page, exercise: string) {
  await openWorkout(page);
  await page.getByLabel('היסטוריה').nth(HISTORY_ICON[exercise]!).click();
  await expect(page.getByRole('heading', { name: exercise })).toBeVisible();
}

/** Newest session in the journal. */
async function openNewestSession(page: Page) {
  await page.goto('/#/progress');
  await page.locator('a[href*="/progress/session/"]').first().click();
  await expect(page.getByText('חזרה ליומן')).toBeVisible();
}

/** The value under a session-header stat tile ("ציון" / "נפח" / "שיאים"). */
const stat = (page: Page, label: string) =>
  page.locator('.card-flat').filter({ hasText: label }).first().locator('p').last();

/** Log one full 5×5 bench session on a given date. */
async function benchSession(page: Page, date: string, weight: string, reps = '5') {
  await openWorkout(page);
  await page.getByLabel('תאריך האימון').fill(date);
  for (let i = 1; i <= 5; i++) await logSet(page, i, weight, reps);
  await finishAndSave(page);
}

// ---------------------------------------------------------------------------

test('the exercise history page opens clean for a lift with no history at all', async ({ page }) => {
  const errors = failOnConsoleErrors(page);
  await openExerciseHistory(page, BENCH);

  await expect(page.getByText('אין היסטוריה לתרגיל זה')).toBeVisible();
  // Nothing to compare against → no stall verdict, no progression rate.
  await expect(page.getByText('סטטוס: תקוע')).toBeHidden();
  await expect(page.getByText('קצב התקדמות')).toBeHidden();
  expect(errors).toEqual([]);
});

test('one session of history renders the right numbers and no crash', async ({ page }) => {
  const errors = failOnConsoleErrors(page);
  await benchSession(page, daysAgo(0), '60');

  await openExerciseHistory(page, BENCH);
  await expect(page.getByText('תרגיל חדש')).toBeVisible();
  await expect(page.getByText('60kg × 5').first()).toBeVisible();
  await expect(page.getByText('1,500kg').first()).toBeVisible();
  // Epley: 60 × (1 + 5/30) = 70.0
  await expect(page.getByText('70.0', { exact: true })).toBeVisible();
  await expect(page.locator('li.card')).toHaveCount(1);
  // One data point is not a trend and not a stall.
  await expect(page.getByText('קצב התקדמות')).toBeHidden();
  await expect(page.getByText('סטטוס: תקוע')).toBeHidden();
  expect(errors).toEqual([]);
});

test('editing a set rewrites the session volume, score and PR count — and it survives a reload', async ({ page }) => {
  const errors = failOnConsoleErrors(page);
  // Two identical sessions, so the newer one has a volume baseline to be scored against.
  await benchSession(page, daysAgo(7), '60');
  await benchSession(page, daysAgo(0), '60');

  await openNewestSession(page);
  await expect(stat(page, 'נפח')).toHaveText('1,500kg');
  await expect(stat(page, 'ציון')).toHaveText('41');
  await expect(page.getByText('שיאים')).toBeHidden();

  // Set 1 was really a 100 kg top set — a PR on weight, on 1RM and on volume.
  await page.getByLabel('ערוך סט').first().click();
  await page.getByLabel('משקל (kg נטו)').fill('100');
  await page.getByRole('button', { name: 'שמור' }).click();
  await expect(page.getByText('עודכן')).toBeVisible();

  // volume 1700 → ratio 1.133 vs the 1500 baseline, and 1 PR now counts.
  await expect(stat(page, 'נפח')).toHaveText('1,700kg');
  await expect(stat(page, 'שיאים')).toHaveText('1');
  await expect(stat(page, 'ציון')).toHaveText('60');

  await page.reload();
  await expect(stat(page, 'נפח')).toHaveText('1,700kg');
  await expect(stat(page, 'שיאים')).toHaveText('1');
  await expect(stat(page, 'ציון')).toHaveText('60');
  // …and the journal agrees with the detail page.
  await page.goto('/#/progress');
  await expect(page.getByText('1,700kg נפח')).toBeVisible();
  expect(errors).toEqual([]);
});

test('deleting a set rescores the session, and deleting an exercise last set drops the exercise', async ({ page }) => {
  const errors = failOnConsoleErrors(page);
  await openWorkout(page);
  await logSet(page, 1, '60', '5');
  await logSet(page, 2, '60', '5');
  await logSet(page, 1, '30', '7', INCLINE); // the only set of this exercise
  await finishAndSave(page);

  await openNewestSession(page);
  await expect(stat(page, 'נפח')).toHaveText('810kg'); // 600 + 210
  await expect(stat(page, 'ציון')).toHaveText('39');

  // Drop bench set 2.
  await page.getByLabel('מחק סט').nth(1).click();
  await page.getByRole('button', { name: 'מחק' }).last().click();
  await expect(stat(page, 'נפח')).toHaveText('510kg');

  // Drop the incline set — its last one, so the whole exercise leaves the session.
  await page.getByLabel('מחק סט').last().click();
  await page.getByRole('button', { name: 'מחק' }).last().click();
  await expect(stat(page, 'נפח')).toHaveText('300kg');
  await expect(page.getByText(INCLINE)).toBeHidden();

  await page.reload();
  await expect(stat(page, 'נפח')).toHaveText('300kg');
  await expect(page.getByText(INCLINE)).toBeHidden();
  // Gone from the exercise's own history too, not just from this screen.
  await openExerciseHistory(page, INCLINE);
  await expect(page.getByText('אין היסטוריה לתרגיל זה')).toBeVisible();
  expect(errors).toEqual([]);
});

test('a better session is reported as a שיא and a worse one is not', async ({ page }) => {
  const errors = failOnConsoleErrors(page);
  await benchSession(page, daysAgo(14), '60');
  await benchSession(page, daysAgo(7), '80'); // clearly better: +20 kg on every set

  await openNewestSession(page);
  await expect(stat(page, 'שיאים')).toHaveText('1');
  await openExerciseHistory(page, BENCH);
  await expect(page.locator('li.card').first().getByText('שיא חדש')).toBeVisible();

  // Clearly worse: a light day is not a record.
  await benchSession(page, daysAgo(0), '50', '3');

  await openNewestSession(page);
  await expect(page.getByText('שיאים')).toBeHidden();
  await openExerciseHistory(page, BENCH);
  await expect(page.locator('li.card').first().getByText('ירידה')).toBeVisible();
  await expect(page.locator('li.card').first().getByText('שיא חדש')).toBeHidden();
  expect(errors).toEqual([]);
});

test('three identical sessions flag a stall and suggest a concrete deload', async ({ page }) => {
  const errors = failOnConsoleErrors(page);
  for (const date of [daysAgo(14), daysAgo(7), daysAgo(0)]) {
    await benchSession(page, date, '60');
  }

  await openExerciseHistory(page, BENCH);
  await expect(page.getByText('סטטוס: תקוע')).toBeVisible();
  await expect(page.getByText('60.0 → 55.0 kg')).toBeVisible(); // ~10 %, rounded to a plate pair
  await expect(page.getByText('(–8%)')).toBeVisible();
  await expect(page.getByText('או החלף ל:')).toBeVisible();
  // 14 days with no change in top weight → a flat rate, not a divide-by-zero.
  await expect(page.getByText('+0 kg / חודש')).toBeVisible();
  expect(errors).toEqual([]);
});

test('two sessions of the same workout on one day are both kept and scored against each other', async ({ page }) => {
  const errors = failOnConsoleErrors(page);
  await benchSession(page, daysAgo(0), '60'); // 1500 kg
  await benchSession(page, daysAgo(0), '70'); // 1750 kg, same date

  await page.goto('/#/progress');
  const cards = page.locator('a[href*="/progress/session/"]');
  await expect(cards).toHaveCount(2);
  // Newest first, and the second one is scored against the first (ratio 1.167).
  await expect(cards.first()).toContainText('1,750kg נפח');
  await expect(cards.first()).toContainText('61');
  await expect(cards.last()).toContainText('1,500kg נפח');
  await expect(cards.last()).toContainText('41');
  expect(errors).toEqual([]);
});

test('the strength standard shows up once sex and bodyweight are on file', async ({ page }) => {
  const errors = failOnConsoleErrors(page);
  await benchSession(page, daysAgo(0), '60'); // best est. 1RM = 70 kg

  // No profile yet → no benchmark.
  await openExerciseHistory(page, BENCH);
  await expect(page.getByText('סטנדרט כוח')).toBeHidden();

  await page.goto('/#/body');
  await page.getByRole('button', { name: 'הוסף מדידה ראשונה' }).click();
  await page.getByLabel('משקל גוף (kg)').fill('80');
  await page.getByLabel('אחוז שומן').fill('20');
  await page.getByRole('button', { name: 'שמור' }).click();
  await expect(page.getByText('מדידה נשמרה')).toBeVisible();

  await page.getByRole('button', { name: 'הגדר פרופיל' }).click();
  await page.getByRole('button', { name: 'זכר' }).click();
  await page.getByLabel('גובה (cm)').fill('180');
  await page.getByRole('button', { name: 'שמור' }).click();
  await expect(page.getByText('הפרופיל נשמר')).toBeVisible();

  // FFMI on the body page: lean 64 kg / 1.8 m² → 19.8, height-normalised.
  const ffmiTile = page.locator('.card-flat').filter({ hasText: 'FFMI' });
  await expect(ffmiTile).toContainText('19.8');
  await expect(ffmiTile).toContainText('ממוצע');

  // …and the lift-specific standard on the exercise history page.
  await openExerciseHistory(page, BENCH);
  await expect(page.getByText('סטנדרט כוח · מתחיל')).toBeVisible();
  await expect(page.getByText('×0.88')).toBeVisible(); // 70 kg 1RM / 80 kg BW
  await expect(page.getByText('מתחיל-בינוני')).toBeVisible();
  await expect(page.getByText('80kg', { exact: true })).toBeVisible(); // novice bar at this BW
  expect(errors).toEqual([]);
});

// Regression: every exercise in the workout used to get an ExerciseLog even
// when it was skipped, giving a lift he never performed a run of 0 kg
// "sessions" — after three of them the app declared it stalled and prescribed
// a deload for a movement he had never done.
test('a lift that was skipped every session is not treated as stalled', async ({ page }) => {
  for (const date of [daysAgo(14), daysAgo(7), daysAgo(0)]) {
    await benchSession(page, date, '60');
  }

  await openExerciseHistory(page, 'Lateral Raise');
  await expect(page.getByText('אין היסטוריה לתרגיל זה')).toBeVisible();
  await expect(page.getByText('סטטוס: תקוע')).toBeHidden();

  await page.goto('/#/');
  await expect(page.getByText('Lateral Raise')).toBeHidden();
});

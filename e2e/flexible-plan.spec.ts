import { test, expect, type Page } from '@playwright/test';
import { BENCH, failOnConsoleErrors, finishAndSave, logSet, openWorkout, weightBox, pickWorkout } from './helpers';

/**
 * The plan bends without losing history: an exercise can be swapped for one
 * session or for good, moved between workouts, and taken out of the plan —
 * and in every case its logged sessions stay reachable and keep feeding the
 * progression engine.
 */

const card = (page: Page, exercise: string) =>
  page.locator('.card', { has: page.getByRole('heading', { name: exercise }) }).first();

async function exerciseMenu(page: Page, exercise: string, item: string | RegExp) {
  await card(page, exercise).getByLabel('פעולות').click();
  await page.getByRole('button', { name: item }).click();
}

const workoutCard = (page: Page, name: string) =>
  page.locator('.card').filter({ has: page.getByRole('button', { name: new RegExp(name) }) }).first();

async function openPlan(page: Page) {
  await page.goto('/#/plan');
  await expect(page.getByRole('heading', { name: 'עוצמה Upper/Lower' })).toBeVisible();
}

async function openLibrary(page: Page) {
  await page.getByRole('button', { name: /תרגילים מחוץ לתכנית/ }).click();
}

const libraryRow = (page: Page, name: string) =>
  page.getByRole('listitem').filter({ hasText: name }).filter({ has: page.getByRole('button', { name: 'החזר לתכנית' }) });

test('a session-only swap survives a reload and leaves the plan alone', async ({ page }) => {
  const errors = failOnConsoleErrors(page);
  const NEW = 'הנפה לצד בכבל';
  await openWorkout(page);

  await exerciseMenu(page, 'Lateral Raise', /החלף תרגיל/);
  // Suggestions are driven by muscles: a lateral raise gets lateral raises.
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('מתאימים')).toBeVisible();
  await dialog.getByText(NEW, { exact: true }).click();

  await expect(page.getByRole('heading', { name: NEW })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Lateral Raise' })).toHaveCount(0);

  await logSet(page, 1, '7.5', '12', NEW);
  await page.reload();
  await pickWorkout(page, 'UA');
  await expect(weightBox(page, 1, NEW)).toHaveValue('7.5');
  // The removed plan exercise must not sneak back in on restore.
  await expect(page.getByRole('heading', { name: 'Lateral Raise' })).toHaveCount(0);

  await finishAndSave(page);

  // Next session: the plan's own exercise is back, the one-off is not.
  await openWorkout(page);
  await expect(page.getByRole('heading', { name: 'Lateral Raise' })).toBeVisible();
  await expect(page.getByRole('heading', { name: NEW })).toHaveCount(0);

  // …but it lives in the library with its history.
  await openPlan(page);
  await openLibrary(page);
  await expect(libraryRow(page, NEW)).toContainText('1 אימונים');
  expect(errors).toEqual([]);
});

test('removing an exercise from the plan keeps its history, and restoring it resumes progression', async ({ page }) => {
  const errors = failOnConsoleErrors(page);
  await openWorkout(page);
  await logSet(page, 1, '80', '5');
  await finishAndSave(page);

  await openPlan(page);
  await page.getByRole('button', { name: /^UAUpper A/ }).click();
  const row = workoutCard(page, '^UAUpper A').getByRole('listitem').filter({ hasText: BENCH });
  await row.getByLabel('הסר תרגיל').click();
  await page.getByRole('dialog').getByRole('button', { name: 'הוצא', exact: true }).click();
  await expect(page.getByText('הועבר לספריית התרגילים')).toBeVisible();

  await openLibrary(page);
  await expect(libraryRow(page, BENCH)).toContainText('1 אימונים');

  // Gone from the next session…
  await page.goto('/#/workout');
  await pickWorkout(page, 'UA');
  await expect(page.getByRole('heading', { name: 'Incline DB Press' })).toBeVisible();
  await expect(page.getByRole('heading', { name: BENCH })).toHaveCount(0);

  // …and back, with its last session intact.
  await openPlan(page);
  await openLibrary(page);
  await libraryRow(page, BENCH).getByRole('button', { name: 'החזר לתכנית' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'חזה', exact: true }).click();
  await expect(page.getByText(/הוחזר ל/)).toBeVisible();

  await openWorkout(page);
  await expect(card(page, BENCH).getByText('80×5')).toBeVisible();
  expect(errors).toEqual([]);
});

test('a permanent swap puts the new exercise in the plan and archives the old one', async ({ page }) => {
  const errors = failOnConsoleErrors(page);
  const NEW = 'לחיצת חזה במכונה';
  await openWorkout(page);

  await exerciseMenu(page, 'Incline DB Press', /החלף תרגיל/);
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'גם בתכנית', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'גם בתכנית', exact: true })).toHaveAttribute('data-active', 'true');
  await dialog.getByText(NEW, { exact: true }).click();
  await expect(page.getByRole('heading', { name: NEW })).toBeVisible();

  // Start over: a fresh session is built from the plan, which now has it.
  await page.getByLabel('התחל מחדש').click();
  await page.getByRole('dialog').getByRole('button', { name: 'התחל מחדש' }).click();
  await expect(page.getByRole('heading', { name: NEW })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Incline DB Press' })).toHaveCount(0);

  await openPlan(page);
  await openLibrary(page);
  await expect(libraryRow(page, 'Incline DB Press')).toBeVisible();
  expect(errors).toEqual([]);
});

test('an exercise can be moved to another workout, history and all', async ({ page }) => {
  const errors = failOnConsoleErrors(page);
  await openWorkout(page);
  await logSet(page, 1, '10', '12', 'Lateral Raise');
  await finishAndSave(page);

  await openPlan(page);
  await page.getByRole('button', { name: /^UAUpper A/ }).click();
  const row = workoutCard(page, '^UAUpper A').getByRole('listitem').filter({ hasText: 'Lateral Raise' });
  await row.getByLabel('העבר תרגיל').click();
  await page.getByRole('dialog').getByRole('button', { name: 'גב-רוחב', exact: true }).click();
  await expect(page.getByText(/הועבר ל/)).toBeVisible();

  await page.goto('/#/workout');
  await pickWorkout(page, 'UB');
  await expect(card(page, 'Lateral Raise').getByText('10×12')).toBeVisible();
  await pickWorkout(page, 'UA');
  await expect(page.getByRole('heading', { name: BENCH })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Lateral Raise' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

import { test, expect, type Page } from '@playwright/test';
import { BENCH, openWorkout, logSet, finishAndSave, tickButton, failOnConsoleErrors } from './helpers';

/**
 * Reordering exercises mid-workout (owner, 23.11.2026: "I can't change the
 * order of the exercises inside the workout"). Session-only: the logged sets
 * travel with their exercise, the order survives a reload, and the plan's own
 * order is untouched for the next session.
 */

const INCLINE = 'Incline DB Press';
const OHP = 'Overhead Press';

const order = (page: Page) => page.locator('main h3').allTextContents();

const card = (page: Page, exercise: string) =>
  page.locator('.card', { has: page.getByRole('heading', { name: exercise, exact: true }) }).first();

test('move an exercise from its ⋯ menu and from the reorder list; survives reload; plan unchanged', async ({ page }) => {
  const errors = failOnConsoleErrors(page);
  await openWorkout(page);
  expect((await order(page)).slice(0, 3)).toEqual([BENCH, INCLINE, OHP]);

  await logSet(page, 1, '60', '5');

  // ⋯ → move down: bench swaps with the incline press, its set comes along.
  await card(page, BENCH).getByLabel('פעולות').click();
  await page.getByRole('button', { name: 'הזז למטה' }).click();
  expect((await order(page)).slice(0, 3)).toEqual([INCLINE, BENCH, OHP]);

  // Reorder list: bring the overhead press to the top with two arrow taps.
  await page.getByRole('button', { name: 'סדר תרגילים' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(`הזז למעלה ${OHP}`).click();
  await dialog.getByLabel(`הזז למעלה ${OHP}`).click();
  await expect(dialog.getByLabel(`הזז למעלה ${OHP}`)).toBeDisabled();
  await dialog.getByRole('button', { name: 'סיום' }).click();
  expect((await order(page)).slice(0, 3)).toEqual([OHP, INCLINE, BENCH]);

  // Reload: the chosen order and the logged set are both still there.
  await page.waitForTimeout(700);
  await page.reload();
  await expect(page.getByRole('heading', { name: BENCH })).toBeVisible();
  expect((await order(page)).slice(0, 3)).toEqual([OHP, INCLINE, BENCH]);
  await expect(tickButton(page, 1)).toHaveAccessibleName(/^בטל סימון/);

  // Save, then start the same workout again: the plan's order is back.
  await finishAndSave(page);
  await openWorkout(page);
  expect((await order(page)).slice(0, 3)).toEqual([BENCH, INCLINE, OHP]);
  expect(errors).toEqual([]);
});

test('a reorder alone is kept across a reload', async ({ page }) => {
  await openWorkout(page);
  await card(page, BENCH).getByLabel('פעולות').click();
  await page.getByRole('button', { name: 'הזז למטה' }).click();
  expect((await order(page)).slice(0, 2)).toEqual([INCLINE, BENCH]);
  await page.waitForTimeout(700);
  await page.reload();
  await expect(page.getByRole('heading', { name: BENCH })).toBeVisible();
  expect((await order(page)).slice(0, 2)).toEqual([INCLINE, BENCH]);
});

test('an exercise moved into the workout in the plan mid-session shows up at its plan spot', async ({ page }) => {
  const errors = failOnConsoleErrors(page);
  const PULLUP = 'Weighted Pull-up';
  await page.goto('/#/workout');
  await page.getByRole('button', { name: 'UB', exact: true }).click();
  await expect(card(page, PULLUP)).toBeVisible();
  await logSet(page, 1, '10', '5', PULLUP);
  await page.waitForTimeout(700);

  await page.goto('/#/plan');
  const ua = page.getByRole('button', { name: /^UAUpper A/ });
  await ua.click();
  const row = page
    .locator('.card', { has: ua })
    .getByRole('listitem')
    .filter({ hasText: 'Lateral Raise' });
  await row.getByLabel('העבר תרגיל').click();
  await page.getByRole('dialog').getByRole('button', { name: 'גב-רוחב', exact: true }).click();
  await expect(page.getByText(/הועבר ל/)).toBeVisible();

  await page.goto('/#/workout');
  await page.getByRole('button', { name: 'UB', exact: true }).click();
  await expect(page.getByText('נוסף מהתכנית: Lateral Raise')).toBeVisible();
  const names = await order(page);
  // Filed into the first muscle group, so it lands with that group, not last.
  expect(names.indexOf('Lateral Raise')).toBeGreaterThan(0);
  expect(names.indexOf('Lateral Raise')).toBeLessThan(names.length - 1);
  await expect(tickButton(page, 1, PULLUP)).toHaveAccessibleName(/^בטל סימון/);
  expect(errors).toEqual([]);
});

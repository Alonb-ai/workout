import { test, expect, type Page } from '@playwright/test';
import {
  BENCH,
  openWorkout,
  logSet,
  finishAndSave,
  tickButton,
  failOnConsoleErrors,
} from './helpers';

/**
 * Exercise notes, warm-up ramp, drop sets and supersets.
 */

const INCLINE = 'Incline DB Press';

const card = (page: Page, exercise: string) =>
  page.locator('.card', { has: page.getByRole('heading', { name: exercise, exact: true }) }).first();

const skipRest = (page: Page) => page.getByRole('button', { name: 'דלג' });

test('a pinned note survives an unsaved session, and a session note shows up next time', async ({ page }) => {
  const errors = failOnConsoleErrors(page);
  await openWorkout(page);

  await card(page, BENCH).getByLabel('הערות לתרגיל').click();
  await page.getByLabel('הערה קבועה לתרגיל').fill('ספסל בחור 3, אחיזה רחבה');
  await page.getByLabel('הערה לאימון הזה').fill('להישאר על 60 עד 5×5');
  await page.getByRole('button', { name: 'סיום' }).click();
  await expect(card(page, BENCH).getByText('ספסל בחור 3, אחיזה רחבה')).toBeVisible();
  await expect(card(page, BENCH).getByText('להישאר על 60 עד 5×5')).toBeVisible();

  // The session note is in the autosaved draft: it survives a reload.
  await page.waitForTimeout(700);
  await page.reload();
  await expect(page.getByRole('heading', { name: BENCH })).toBeVisible();
  await expect(card(page, BENCH).getByText('להישאר על 60 עד 5×5')).toBeVisible();

  await logSet(page, 1, '60', '5');
  await finishAndSave(page);

  // Next session: pinned note still there, and last time's note as a reminder.
  await openWorkout(page);
  const c = card(page, BENCH);
  await expect(c.getByText('ספסל בחור 3, אחיזה רחבה')).toBeVisible();
  await expect(c.getByText(/פעם קודמת/)).toBeVisible();
  await expect(c.getByText('להישאר על 60 עד 5×5')).toBeVisible();
  expect(errors).toEqual([]);
});

test('warm-up ramp is computed from the working weight, including the bar', async ({ page }) => {
  await openWorkout(page);
  await card(page, BENCH).getByLabel(`חימום · ${BENCH}`).click();
  await page.getByLabel('משקל עבודה לחימום').fill('60');
  const list = page.getByRole('list', { name: 'סטים לחימום' });
  // 60 net + 20 bar → bar ×10, 10 ×8, 27.5 ×5, 42.5 ×3.
  await expect(list.getByRole('listitem')).toHaveCount(4);
  await expect(list).toContainText('42.5kg');
  await page.getByRole('button', { name: 'סיום' }).click();
});

test('a drop set holds the rest timer until it is done, and is not a planned set', async ({ page }) => {
  await openWorkout(page);
  await weightBoxFill(page, '60', '5');
  await card(page, BENCH).getByLabel(`הוסף דרופ סט · ${BENCH}`).click();

  // Set 1 done, its drop is still open: no rest yet.
  await tickButton(page, 1).click();
  await expect(skipRest(page)).toHaveCount(0);

  const drop = page.getByLabel(new RegExp(`חזרות · ${BENCH} · דרופ`));
  await drop.fill('8');
  await page.getByLabel(new RegExp(`^(סמן|סמן לפי היעד) · ${BENCH} · דרופ`)).click();
  await expect(skipRest(page)).toBeVisible();
  // Counter counts planned sets only.
  await expect(card(page, BENCH).getByText('1/5')).toBeVisible();
});

async function weightBoxFill(page: Page, w: string, r: string) {
  await page.getByLabel(`משקל · ${BENCH} · סט 1`).fill(w);
  await page.getByLabel(`חזרות · ${BENCH} · סט 1`).fill(r);
}

test('superset: rest starts only after both exercises did the round, and the pairing is kept', async ({ page }) => {
  await openWorkout(page);
  await card(page, BENCH).getByLabel('פעולות').click();
  await page.getByRole('button', { name: /סופרסט עם התרגיל הבא/ }).click();
  await expect(page.getByRole('group', { name: 'סופרסט' })).toBeVisible();

  await logSet(page, 1, '60', '5');
  await expect(page.getByText(`סופרסט · עכשיו ${INCLINE}`)).toBeVisible();
  await expect(skipRest(page)).toHaveCount(0);

  await logSet(page, 1, '20', '7', INCLINE);
  await expect(skipRest(page)).toBeVisible();

  await finishAndSave(page);
  await openWorkout(page);
  await expect(page.getByRole('group', { name: 'סופרסט' })).toBeVisible();
});

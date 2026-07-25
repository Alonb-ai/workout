import { test, expect, type Page } from '@playwright/test';
import {
  BENCH,
  openWorkout,
  logSet,
  finishAndSave,
  weightBox,
  repsBox,
  failOnConsoleErrors,
} from './helpers';

/**
 * The active logger, from the owner's chair. Everything here is something he
 * actually does mid-workout: bolt an extra set on, drop a lift he skipped, fix
 * a target he set wrong, jump between the two workouts he alternates.
 */

const LEGPRESS = 'Leg Press'; // LA, first exercise: 5×4-6, machine, seedWeight 80
const OHP = 'Overhead Press'; // UA, 4×4-6

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The card of one exercise, so ⋯ / "הוסף סט" hit the right lift. */
const card = (page: Page, exercise: string) =>
  page.locator('.card', { has: page.getByRole('heading', { name: exercise, exact: true }) }).first();

/** Visible set rows for an exercise — one ✓ button each. */
const setRows = (page: Page, exercise = BENCH) =>
  page.getByLabel(new RegExp(`^(סמן|סמן לפי היעד|בטל סימון) · ${escapeRe(exercise)} · סט \\d+$`));

const removeSetButton = (page: Page, set: number, exercise = BENCH) =>
  page.getByLabel(`מחק · ${exercise} · סט ${set}`);

const rpeChip = (page: Page, set: number, exercise = BENCH) =>
  page.getByLabel(`ערוך RPE · ${exercise} · סט ${set}`);

/** The floating rest-timer bar, identified by its skip button. */
const restBar = (page: Page) =>
  page.locator('div').filter({ has: page.getByRole('button', { name: 'דלג' }) }).last();

async function exerciseMenu(page: Page, exercise: string, item: string | RegExp) {
  await card(page, exercise).getByLabel('פעולות').click();
  await page.getByRole('button', { name: item }).click();
}

/**
 * The number fields inside the ⋯ modals have no `htmlFor`/`aria-label`, so they
 * are reached through their wrapper rather than by accessible name.
 */
const modalField = (page: Page, label: string) =>
  page
    .getByRole('dialog')
    .locator('div')
    .filter({ has: page.locator('label', { hasText: label }) })
    .last()
    .locator('input');

/**
 * Send the app to the background and bring it back — the moment iOS gives the
 * PWA to flush its draft. Anything logged must be on disk by the time we return.
 */
async function backgroundApp(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(150);
}

test('an extra set and a deleted set both survive backgrounding + reload', async ({ page }) => {
  const errors = failOnConsoleErrors(page);
  await openWorkout(page);

  // Bench ships with 5 rows; a good day earns a 6th.
  await expect(setRows(page)).toHaveCount(5);
  await card(page, BENCH).getByRole('button', { name: 'הוסף סט' }).click();
  await expect(setRows(page)).toHaveCount(6);

  await logSet(page, 1, '60', '5');
  await logSet(page, 2, '62.5', '4');
  await logSet(page, 3, '65', '3');

  // Row 2 was a mis-tap — delete it. Rows renumber and the values shift up.
  await removeSetButton(page, 2).click();
  await expect(setRows(page)).toHaveCount(5);
  await expect(weightBox(page, 2)).toHaveValue('65');
  await expect(repsBox(page, 2)).toHaveValue('3');
  await expect(page.getByText('2 / 21 סטים')).toBeVisible();

  await backgroundApp(page);
  await page.reload();
  await page.getByRole('button', { name: 'UA', exact: true }).click();
  await expect(page.getByText('המשך טיוטה')).toBeVisible();

  await expect(setRows(page)).toHaveCount(5);
  await expect(weightBox(page, 1)).toHaveValue('60');
  await expect(weightBox(page, 2)).toHaveValue('65');
  await expect(repsBox(page, 2)).toHaveValue('3');
  await expect(page.getByText('2 / 21 סטים')).toBeVisible();
  expect(errors).toEqual([]);
});

test('"ביטול" in the target editor discards, "שמור" reaches the next session', async ({ page }) => {
  await openWorkout(page);
  await expect(page.getByText('חזה · 5×3-5 · מנוחה 3:00')).toBeVisible();

  // Open it, change everything, back out. Nothing may stick.
  await exerciseMenu(page, BENCH, /עריכת יעד/);
  await modalField(page, 'סטים').fill('3');
  await modalField(page, 'חזרות מינ׳').fill('8');
  await page.getByRole('button', { name: 'ביטול' }).click();
  await expect(page.getByText('חזה · 5×3-5 · מנוחה 3:00')).toBeVisible();
  await expect(setRows(page)).toHaveCount(5);

  // Now for real: 3 × 6-8, 90 s rest.
  await exerciseMenu(page, BENCH, /עריכת יעד/);
  await modalField(page, 'סטים').fill('3');
  await modalField(page, 'חזרות מינ׳').fill('6');
  await modalField(page, 'חזרות מקס׳').fill('8');
  await modalField(page, 'מנוחה (שניות)').fill('90');
  await page.getByRole('button', { name: 'שמור', exact: true }).click();

  await expect(page.getByText('חזה · 3×6-8 · מנוחה 1:30')).toBeVisible();
  await expect(setRows(page)).toHaveCount(3);
  await expect(page.getByText('0 / 19 סטים')).toBeVisible(); // 21 − 2

  for (let i = 1; i <= 3; i++) await logSet(page, i, '60', '8');
  await finishAndSave(page);

  // The edited target is what the owner is handed next time.
  await openWorkout(page);
  await expect(page.getByText('חזה · 3×6-8 · מנוחה 1:30')).toBeVisible();
  await expect(setRows(page)).toHaveCount(3);
});

test('lowering the target set count never deletes a set that was already ticked', async ({ page }) => {
  await openWorkout(page);
  await logSet(page, 1, '60', '5');
  await logSet(page, 5, '40', '10'); // a back-off set on the last row
  await expect(page.getByText('2 / 21 סטים')).toBeVisible();

  await exerciseMenu(page, BENCH, /עריכת יעד/);
  await modalField(page, 'סטים').fill('2');
  await page.getByRole('button', { name: 'שמור', exact: true }).click();

  // Target is 2 now, but row 5 was logged — it must still be there, intact.
  await expect(page.getByText('חזה · 2×3-5 · מנוחה 3:00')).toBeVisible();
  await expect(setRows(page)).toHaveCount(5);
  await expect(weightBox(page, 5)).toHaveValue('40');
  await expect(repsBox(page, 5)).toHaveValue('10');
  await expect(page.getByText('2 / 18 סטים')).toBeVisible(); // 21 − 3
});

test('renaming without "החל גם על אימונים הבאים" only touches this session', async ({ page }) => {
  const LONG = 'לחיצת חזה במוט בשכיבה על ספסל שטוח עם אחיזה בינונית';
  await openWorkout(page);

  await exerciseMenu(page, BENCH, 'שנה שם תרגיל');
  await page.getByRole('dialog').locator('input.input').fill(LONG);
  await page.getByRole('button', { name: 'שמור', exact: true }).click();

  await expect(page.getByRole('heading', { name: LONG })).toBeVisible();
  await expect(page.getByRole('heading', { name: BENCH })).toHaveCount(0);
  // The row controls are relabelled too, or the set is unreachable by name.
  await logSet(page, 1, '60', '5', LONG);
  await finishAndSave(page);

  // History keeps the name it was logged under…
  await expect(page.getByText(LONG).first()).toBeVisible();
  // …but the plan exercise was untouched, so the next session is back to normal.
  await openWorkout(page);
  await expect(page.getByRole('heading', { name: BENCH })).toBeVisible();
  await expect(page.getByRole('heading', { name: LONG })).toHaveCount(0);
});

test('renaming with "החל גם על אימונים הבאים" sticks for the next session', async ({ page }) => {
  const NEW = 'לחיצת חזה';
  await openWorkout(page);

  await exerciseMenu(page, BENCH, 'שנה שם תרגיל');
  await page.getByRole('dialog').locator('input.input').fill(NEW);
  await page.getByRole('dialog').getByRole('checkbox').check();
  await page.getByRole('button', { name: 'שמור', exact: true }).click();
  await expect(page.getByRole('heading', { name: NEW, exact: true })).toBeVisible();

  await logSet(page, 1, '60', '5', NEW);
  await finishAndSave(page);

  await openWorkout(page, 'UA', NEW);
  await expect(page.getByRole('heading', { name: BENCH })).toHaveCount(0);
});

test('each workout tab keeps its own draft and nothing leaks between them', async ({ page }) => {
  const errors = failOnConsoleErrors(page);
  await openWorkout(page);
  await logSet(page, 1, '60', '5');
  await logSet(page, 2, '60', '5');

  // Jump to Lower A mid-session.
  await page.getByRole('button', { name: 'LA', exact: true }).click();
  await expect(page.getByRole('heading', { name: LEGPRESS })).toBeVisible();
  await expect(page.getByText('0 / 22 סטים')).toBeVisible();
  await expect(weightBox(page, 1, LEGPRESS)).toHaveValue('');
  await logSet(page, 1, '100', '6', LEGPRESS);
  await expect(page.getByText('1 / 22 סטים')).toBeVisible();

  // Back to Upper A — its two sets are exactly where they were.
  await page.getByRole('button', { name: 'UA', exact: true }).click();
  await expect(page.getByRole('heading', { name: BENCH })).toBeVisible();
  await expect(page.getByText('2 / 21 סטים')).toBeVisible();
  await expect(weightBox(page, 1)).toHaveValue('60');
  await expect(weightBox(page, 3)).toHaveValue('');

  // Both drafts survive a reload, independently.
  await backgroundApp(page);
  await page.reload();
  await page.getByRole('button', { name: 'LA', exact: true }).click();
  await expect(weightBox(page, 1, LEGPRESS)).toHaveValue('100');
  await expect(repsBox(page, 1, LEGPRESS)).toHaveValue('6');
  await page.getByRole('button', { name: 'UA', exact: true }).click();
  await expect(weightBox(page, 1)).toHaveValue('60');
  await expect(page.getByText('2 / 21 סטים')).toBeVisible();
  expect(errors).toEqual([]);
});

test('a lift can be pulled in from another workout and a brand-new one invented', async ({ page }) => {
  const errors = failOnConsoleErrors(page);
  const INVENTED = 'מקבילים בתוספת משקל';
  await openWorkout(page);

  // Borrow a lift that lives in Upper B.
  await page.getByRole('button', { name: 'הוסף תרגיל לאימון' }).click();
  await page.getByPlaceholder('חיפוש לפי שם או קבוצת שריר…').fill('Cable Row');
  await page.getByRole('button', { name: /Cable Row/ }).click();
  await expect(page.getByRole('heading', { name: 'Cable Row' })).toBeVisible();
  await expect(page.getByText('0 / 24 סטים')).toBeVisible(); // 21 + 3

  // …and invent one on the spot.
  await page.getByRole('button', { name: 'הוסף תרגיל לאימון' }).click();
  await page.getByRole('button', { name: 'תרגיל חדש' }).click();
  await page.getByPlaceholder('לדוגמה: Cable Crossover').fill(INVENTED);
  await page.getByRole('button', { name: 'הוסף', exact: true }).click();
  await expect(page.getByRole('heading', { name: INVENTED })).toBeVisible();
  await expect(page.getByText('0 / 27 סטים')).toBeVisible(); // + 3

  // It has no history, so one tap must not be able to log a 0 kg set.
  await expect(page.getByLabel(`סמן · ${INVENTED} · סט 1`)).toBeDisabled();

  await logSet(page, 1, '20', '8', INVENTED);
  await backgroundApp(page);
  await page.reload();
  await page.getByRole('button', { name: 'UA', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Cable Row' })).toBeVisible();
  await expect(weightBox(page, 1, INVENTED)).toHaveValue('20');
  expect(errors).toEqual([]);
});

test('removing a lift drops its planned sets and it can be pulled straight back in', async ({ page }) => {
  await openWorkout(page);
  await logSet(page, 1, '50', '5', OHP);
  await expect(page.getByText('1 / 21 סטים')).toBeVisible();

  await exerciseMenu(page, OHP, 'הסר תרגיל מהאימון');
  await page.getByRole('button', { name: 'הסר', exact: true }).click();
  await expect(page.getByRole('heading', { name: OHP })).toHaveCount(0);
  await expect(page.getByText('0 / 17 סטים')).toBeVisible(); // 21 − 4, and its logged set is gone

  // Gone from this session only — the plan still offers it.
  await page.getByRole('button', { name: 'הוסף תרגיל לאימון' }).click();
  await page.getByPlaceholder('חיפוש לפי שם או קבוצת שריר…').fill('Overhead Press');
  await page.getByRole('button', { name: /Overhead Press/ }).click();
  await expect(page.getByRole('heading', { name: OHP })).toBeVisible();
  await expect(page.getByText('0 / 21 סטים')).toBeVisible();
  await expect(weightBox(page, 1, OHP)).toHaveValue('');
});

test('saving with nothing ticked is refused, and "התחל מחדש" really wipes the draft', async ({ page }) => {
  await openWorkout(page);

  // Typing without ticking is not a workout.
  await weightBox(page, 1).fill('60');
  await page.getByRole('button', { name: 'סיים ושמור' }).click();
  await expect(page.getByText('לא סומנו סטים — סמנו לפחות סט אחד לפני שמירה.')).toBeVisible();
  await expect(page.getByText('סיכום לפני שמירה')).toHaveCount(0);

  await logSet(page, 1, '60', '5');
  await expect(page.getByText(/טיוטה נשמרה|המשך טיוטה/)).toBeVisible();

  await page.getByLabel('התחל מחדש').click();
  await page.getByRole('dialog').getByRole('button', { name: 'התחל מחדש' }).click();
  await expect(page.getByText('הטיוטה נמחקה — אפשר להתחיל מחדש.')).toBeVisible();
  await expect(weightBox(page, 1)).toHaveValue('');
  await expect(page.getByText('0 / 21 סטים')).toBeVisible();

  // Gone from storage, not just from the screen.
  await page.reload();
  await page.getByRole('button', { name: 'UA', exact: true }).click();
  await expect(weightBox(page, 1)).toHaveValue('');
  await expect(page.getByText('המשך טיוטה')).toHaveCount(0);
});

test('ticking a set starts the named rest timer, and RPE is kept per set', async ({ page }) => {
  await openWorkout(page);
  await logSet(page, 1, '60', '5');

  // Bench rests 3 min and the bar says which lift, so a glance is enough.
  await expect(restBar(page)).toContainText(BENCH);
  await expect(restBar(page)).toContainText(/[0-9]:[0-9]{2}/);

  await rpeChip(page, 1).click();
  await page.getByLabel('RPE', { exact: true }).fill('8.5');
  await expect(rpeChip(page, 1)).toHaveText('R8.5');
  await expect(rpeChip(page, 2)).toHaveText('RPE'); // and it stays on its own row

  await page.getByRole('button', { name: 'דלג' }).click();
  await expect(page.getByRole('button', { name: 'דלג' })).toHaveCount(0);

  await backgroundApp(page);
  await page.reload();
  await page.getByRole('button', { name: 'UA', exact: true }).click();
  await expect(rpeChip(page, 1)).toHaveText('R8.5');
});

test('sets the owner never touched do not land in history as 0 kg × 0', async ({ page }) => {
  await openWorkout(page);
  await logSet(page, 1, '60', '5');
  await logSet(page, 2, '60', '4');
  // Rows 3-5 are never touched at all.
  await finishAndSave(page);

  await page.getByRole('link', { name: /Upper A/ }).first().click();
  await expect(page.getByText('סט 1').first()).toBeVisible();
  await expect(page.getByText('סט 2').first()).toBeVisible();
  await expect(page.getByText('סט 3')).toHaveCount(0);
  await expect(page.getByText('0 × 0')).toHaveCount(0);
});


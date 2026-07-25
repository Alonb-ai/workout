import { test, expect } from '@playwright/test';
import {
  BENCH,
  openWorkout,
  logSet,
  finishAndSave,
  weightBox,
  repsBox,
} from './helpers';

test('a first session has nothing to prescribe and refuses to log an empty set', async ({ page }) => {
  await openWorkout(page);
  await expect(page.getByText('קבע משקל התחלה').first()).toBeVisible();
  // No prescription → the ✓ must not be tappable, or one tap would record 0 kg.
  await expect(page.getByLabel(`סמן · ${BENCH} · סט 1`)).toBeDisabled();
});

test('logged sets survive a full page reload', async ({ page }) => {
  await openWorkout(page);
  await logSet(page, 1, '60', '5');
  await expect(page.getByText('1 / 21 סטים')).toBeVisible();

  // The draft autosave is debounced; leaving the screen flushes it immediately.
  await expect(page.getByText(/טיוטה נשמרה|המשך טיוטה/).first()).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: 'UA', exact: true }).click();
  await expect(weightBox(page, 1)).toHaveValue('60');
  await expect(repsBox(page, 1)).toHaveValue('5');
  await expect(page.getByText('המשך טיוטה')).toBeVisible();
});

test('hitting the top of the rep range prescribes more weight next session', async ({ page }) => {
  await openWorkout(page);
  // 5 sets × 5 reps at 60 kg — the top of bench's 3-5 range, on every set.
  for (let i = 1; i <= 5; i++) await logSet(page, i, '60', '5');
  await expect(page.getByText('5 / 21 סטים')).toBeVisible();
  await finishAndSave(page);

  await openWorkout(page);
  // 60 + 2.5 (smallest owned plate pair: 1.25 × 2). The strip renders the
  // figures themselves, so assert on the parts rather than on a sentence.
  const strip = page.locator('.card', { hasText: BENCH }).first();
  await expect(strip.getByText('העלאת משקל')).toBeVisible();
  await expect(strip.getByText('+2.5')).toBeVisible();
  await expect(strip.getByText('62.5', { exact: true })).toBeVisible();
  await expect(page.getByText('60×5,5,5,5,5')).toBeVisible();
  // …and one tap now logs exactly that.
  await page.getByLabel(`סמן לפי היעד · ${BENCH} · סט 1`).click();
  await expect(weightBox(page, 1)).toHaveValue('62.5');
  await expect(repsBox(page, 1)).toHaveValue('3');
});

test('falling short of the rep range holds the weight instead of raising it', async ({ page }) => {
  await openWorkout(page);
  for (let i = 1; i <= 4; i++) await logSet(page, i, '60', '5');
  await logSet(page, 5, '60', '3'); // last set short of the range
  await finishAndSave(page);

  await openWorkout(page);
  const strip = page.locator('.card', { hasText: BENCH }).first();
  await expect(strip.getByText('עוד חזרה')).toBeVisible();
  await expect(strip.getByText('60', { exact: true })).toBeVisible();
  await expect(strip.getByText('העלאת משקל')).toBeHidden();
});

test('a workout logged yesterday and never saved is rescued from the dashboard', async ({ page }) => {
  await openWorkout(page);
  await logSet(page, 1, '60', '5');
  await logSet(page, 2, '60', '5');
  // Backdate the session — this is what "I trained yesterday and forgot to
  // press save" looks like in the data.
  await page.getByLabel('תאריך האימון').fill('2026-07-01');

  await page.goto('/#/');
  await expect(page.getByText('אימון שלא נשמר')).toBeVisible();
  await expect(page.getByText('2/21 סטים')).toBeVisible();

  await page.getByRole('button', { name: 'שמור עכשיו' }).click();
  await expect(page.getByText(/האימון נשמר · ציון/)).toBeVisible();
  await expect(page.getByText('אימון שלא נשמר')).toBeHidden();

  // It landed in history under the date it was actually performed.
  await page.goto('/#/progress');
  await expect(page.getByText('1 ביולי').first()).toBeVisible();
});

// Regression: ticking a set used to go through the same 500 ms debounce as
// typing, so a reload in the moment right after the tap lost it — the flush on
// pagehide is an async IndexedDB write that cannot finish during teardown.
test('a set logged immediately before a reload is not lost', async ({ page }) => {
  await openWorkout(page);
  await logSet(page, 1, '60', '5');
  await expect(page.getByText('1 / 21 סטים')).toBeVisible();
  // No pause: the owner taps ✓ and the tab is reloaded or discarded a moment later.
  await page.reload();
  await page.getByRole('button', { name: 'UA', exact: true }).click();
  await expect(weightBox(page, 1)).toHaveValue('60');
  await expect(repsBox(page, 1)).toHaveValue('5');
});

test('an abandoned empty draft is not offered as unsaved work', async ({ page }) => {
  await openWorkout(page);
  // Type a weight but never tick the set — nothing was confirmed.
  await weightBox(page, 1).fill('60');
  await page.goto('/#/');
  await expect(page.getByText('אימון שלא נשמר')).toBeHidden();
});

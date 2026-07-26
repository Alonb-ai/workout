import { test, expect, type Page } from '@playwright/test';
import { BENCH, openWorkout, logSet, finishAndSave, failOnConsoleErrors } from './helpers';

/**
 * The freestyle workout: off-plan training. It must start empty every time, and
 * a lift pulled into it from the plan has to keep its history — otherwise the
 * progression engine would restart from zero on every freestyle session, which
 * is the whole thing that makes this app worth using.
 */

const freestyleTab = (page: Page) => page.getByRole('button', { name: 'חופשי', exact: true });

/** Read a Dexie table straight out of IndexedDB. */
async function table<T>(page: Page, store: string): Promise<T[]> {
  return page.evaluate(async (s) => {
    const h: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open('iron-track');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return new Promise<unknown[]>((res, rej) => {
      const q = h.transaction(s, 'readonly').objectStore(s).getAll();
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
  }, store) as Promise<T[]>;
}

/** Pull an exercise that already exists in the plan into the open session. */
async function addFromPlan(page: Page, name: string) {
  await page.getByRole('button', { name: 'הוסף תרגיל לאימון' }).click();
  await page.getByRole('dialog').getByText(name, { exact: true }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

test('the freestyle workout does not exist until it is used', async ({ page }) => {
  // Wait for the seed to land before reading the table, or the count races it.
  await openWorkout(page);
  expect(await table(page, 'workouts')).toHaveLength(4); // the seeded UA/LA/UB/LB

  await freestyleTab(page).click();
  await expect(page.getByText('אימון חופשי מתחיל ריק')).toBeVisible();

  const workouts = await table<{ code: string; isFreestyle?: boolean }>(page, 'workouts');
  expect(workouts).toHaveLength(5);
  expect(workouts.filter((w) => w.isFreestyle)).toHaveLength(1);

  // Tapping again reuses the same row rather than minting a second one.
  await page.getByRole('button', { name: 'UA', exact: true }).click();
  await freestyleTab(page).click();
  expect(await table(page, 'workouts')).toHaveLength(5);
});

test('it stays out of the plan tab strip and has no exercises of its own', async ({ page }) => {
  await openWorkout(page);
  await freestyleTab(page).click();
  // The plan's four codes plus the one freestyle pill — the freestyle workout
  // must not also appear as a code tab of its own.
  await expect(page.getByRole('button', { name: 'FS', exact: true })).toBeHidden();
  // Exercise cards use h3; the page's own h1 (the workout name) is expected.
  await expect(page.locator('h3')).toHaveCount(0);
  await expect(page.getByText('אימון חופשי מתחיל ריק')).toBeVisible();
});

test('a lift pulled in from the plan keeps its history and its prescription', async ({ page }) => {
  const errors = failOnConsoleErrors(page);

  // Give the bench a real session first: 5 sets at the top of its 3-5 range.
  await openWorkout(page);
  for (let i = 1; i <= 5; i++) await logSet(page, i, '60', '5');
  await finishAndSave(page);

  await page.goto('/#/workout');
  await freestyleTab(page).click();
  await addFromPlan(page, BENCH);

  // Same lift, same id → the coach carries on instead of restarting.
  const card = page.locator('.card', { hasText: BENCH }).first();
  await expect(card.getByText('העלאת משקל')).toBeVisible();
  await expect(card.getByText('62.5', { exact: true })).toBeVisible();
  await expect(page.getByText('60×5,5,5,5,5')).toBeVisible();

  expect(errors).toEqual([]);
});

test('a freestyle session saves, and the next one starts empty again', async ({ page }) => {
  await page.goto('/#/workout');
  await freestyleTab(page).click();
  await addFromPlan(page, BENCH);
  await logSet(page, 1, '50', '5');
  await finishAndSave(page);

  // Committed to history as its own session.
  const sessions = await table<{ workoutCode: string }>(page, 'sessions');
  expect(sessions).toHaveLength(1);
  expect(sessions[0]!.workoutCode).toBe('FS');

  // …and the next freestyle session is blank, not a repeat of the last one.
  await page.goto('/#/workout');
  await freestyleTab(page).click();
  await expect(page.getByText('אימון חופשי מתחיל ריק')).toBeVisible();
  await expect(page.getByRole('heading', { name: BENCH })).toBeHidden();
});

test('a freestyle draft survives a reload like any other workout', async ({ page }) => {
  await page.goto('/#/workout');
  await freestyleTab(page).click();
  await addFromPlan(page, BENCH);
  await logSet(page, 1, '55', '4');

  await page.reload();
  await freestyleTab(page).click();
  await expect(page.getByRole('heading', { name: BENCH })).toBeVisible();
  await expect(page.getByLabel(`משקל · ${BENCH} · סט 1`)).toHaveValue('55');
  await expect(page.getByText('המשך טיוטה')).toBeVisible();
});

test('an exercise invented in a freestyle session is reusable afterwards', async ({ page }) => {
  await page.goto('/#/workout');
  await freestyleTab(page).click();

  await page.getByRole('button', { name: 'הוסף תרגיל לאימון' }).click();
  await page.getByRole('button', { name: 'תרגיל חדש' }).click();
  await page.getByPlaceholder('לדוגמה: Cable Crossover').fill('סקי ארגומטר');
  await page.getByRole('button', { name: 'הוסף', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'סקי ארגומטר' })).toBeVisible();

  await logSet(page, 1, '30', '20', 'סקי ארגומטר');
  await finishAndSave(page);

  // It became a real plan row, so it can be pulled into a later session with
  // whatever history it accumulates.
  await page.goto('/#/workout');
  await freestyleTab(page).click();
  await addFromPlan(page, 'סקי ארגומטר');
  const card = page.locator('.card', { hasText: 'סקי ארגומטר' }).first();
  await expect(card.getByText('30×20')).toBeVisible();
});

import { test, expect, type Page } from '@playwright/test';
import { failOnConsoleErrors, openWorkout, logSet, weightBox } from './helpers';

/**
 * Plan editor (/#/plan).
 *
 * The owner's #1 usability priority is that reshaping his program is effortless,
 * so these tests drive the editor the way he would: create/rename/duplicate/
 * switch/delete a plan, build a workout from nothing, then check that the plan
 * page, the dashboard, the logger and IndexedDB all tell the same story.
 *
 * Local vocabulary only — helpers.ts is shared and must not grow for one area.
 */

// --- locators ---------------------------------------------------------------

/** Modal text field addressed by its (unassociated) Hebrew label. */
const textField = (page: Page, label: string) =>
  page.locator(
    `xpath=//label[normalize-space()="${label}"]/following-sibling::input[1] | //label[normalize-space()="${label}"]/following-sibling::textarea[1]`,
  );

/** Modal NumberInput addressed by its Hebrew label (label wraps a stepper div). */
const numField = (page: Page, label: string) =>
  page.locator(`xpath=//label[normalize-space()="${label}"]/following-sibling::div[1]//input`);

/** The card of the plan currently being viewed (the one with the edit/dup/delete row). */
const planCard = (page: Page) =>
  page.locator('div.card').filter({ has: page.getByLabel('ערוך תכנית') });

/** A workout card in the plan's workout list, found by any text it shows. */
const workoutCard = (page: Page, text: string) =>
  page.locator('div.card').filter({ hasText: text }).filter({ has: page.getByLabel('גרור') });

const exerciseRow = (page: Page, workout: string, exercise: string) =>
  workoutCard(page, workout).getByRole('listitem').filter({ hasText: exercise });

const addPlanBtn = (page: Page) => page.getByRole('button', { name: 'תכנית', exact: true });
const addWorkoutBtn = (page: Page) => page.getByRole('button', { name: 'אימון', exact: true });
const planPill = (page: Page, name: string | RegExp) =>
  page.getByRole('button', { name: typeof name === 'string' ? new RegExp(`^${name}`) : name });
const saveModal = (page: Page) => page.getByRole('dialog').getByRole('button', { name: 'שמור' });
const confirmDelete = (page: Page) =>
  page.getByRole('dialog').getByRole('button', { name: 'מחק', exact: true });

/** Read a whole Dexie table straight out of IndexedDB — the only way to prove
 *  a cascade delete left no orphans behind rather than merely hid them. */
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

async function openPlan(page: Page) {
  await page.goto('/#/plan');
  await expect(page.getByRole('heading', { name: 'עוצמה Upper/Lower' })).toBeVisible();
}

/** Expand a workout card to reveal its muscle groups / exercises. */
async function expandWorkout(page: Page, code: string, name: string) {
  await page.getByRole('button', { name: new RegExp(`^${code}${name}`) }).click();
}

// --- tests ------------------------------------------------------------------

test('a new plan is empty, and the header, card and workout list never disagree', async ({
  page,
}) => {
  const errors = failOnConsoleErrors(page);
  await openPlan(page);

  await addPlanBtn(page).click();

  // Header, card and list must all be describing the brand-new plan.
  await expect(page.getByRole('heading', { name: 'תכנית חדשה' })).toBeVisible();
  await expect(planCard(page)).toContainText('תכנית חדשה');
  await expect(page.getByText('אין אימונים')).toBeVisible();
  // …and it is not active: the seeded program still is.
  await expect(planCard(page).getByRole('button', { name: 'הגדר כפעילה' })).toBeVisible();
  await expect(planPill(page, 'עוצמה Upper/Lower')).toContainText('פעילה');

  // Switching back must move all three together, not just the header.
  await planPill(page, 'עוצמה Upper/Lower').click();
  await expect(page.getByRole('heading', { name: 'עוצמה Upper/Lower' })).toBeVisible();
  await expect(planCard(page)).toContainText('תכנית כוח 4–6 חזרות');
  await expect(planCard(page).getByRole('button', { name: 'הגדר כפעילה' })).toBeHidden();
  await expect(workoutCard(page, 'Upper A')).toBeVisible();
  await expect(page.getByText('אין אימונים')).toBeHidden();

  expect(errors).toEqual([]);
});

test('renaming a plan updates every place it is shown and survives a reload', async ({ page }) => {
  const errors = failOnConsoleErrors(page);
  const LONG = 'עוצמה ' + 'אימון כוח מתקדם לחיטוב ומסה '.repeat(4);
  await openPlan(page);

  await planCard(page).getByLabel('ערוך תכנית').click();
  await textField(page, 'שם').fill(LONG);
  await textField(page, 'תיאור').fill('מחזור חדש · 4 אימונים בשבוע');
  await saveModal(page).click();

  await expect(page.getByRole('heading', { name: LONG })).toBeVisible();
  await expect(planCard(page)).toContainText('מחזור חדש · 4 אימונים בשבוע');
  await expect(planPill(page, LONG.slice(0, 20))).toBeVisible();

  // A name that long must not push the phone's viewport sideways.
  const box = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(box.scroll).toBe(box.client);

  await page.reload();
  await expect(page.getByRole('heading', { name: LONG })).toBeVisible();
  await expect(planCard(page)).toContainText('מחזור חדש · 4 אימונים בשבוע');

  // A whitespace-only name must not be able to erase the plan's identity.
  await planCard(page).getByLabel('ערוך תכנית').click();
  await textField(page, 'שם').fill('   ');
  await saveModal(page).click();
  await expect(page.getByRole('heading', { name: LONG })).toBeVisible();

  expect(errors).toEqual([]);
});

test('duplicating a plan produces an independent deep copy', async ({ page }) => {
  const errors = failOnConsoleErrors(page);
  await openPlan(page);
  expect(await table(page, 'exercises')).toHaveLength(27);

  await planCard(page).getByLabel('שכפל').click();
  await expect(planPill(page, /עותק/)).toBeVisible();
  // Duplicating must not steal the "active" flag from the plan he is training on.
  await expect(planPill(page, 'עוצמה Upper/Lower·')).toContainText('פעילה');

  await planPill(page, /עותק/).click();
  await expect(page.getByRole('heading', { name: /— עותק$/ })).toBeVisible();
  await expect(workoutCard(page, 'Upper A')).toBeVisible();
  await expect(workoutCard(page, 'Lower B')).toBeVisible();

  // The copy owns its own exercises: 27 more rows, and editing one is local to it.
  expect(await table(page, 'exercises')).toHaveLength(54);
  await expandWorkout(page, 'UA', 'Upper A');
  await exerciseRow(page, 'Upper A', 'Barbell Bench Press').getByLabel('ערוך').click();
  await textField(page, 'שם תרגיל').fill('לחיצת חזה — גרסת העותק');
  await saveModal(page).click();
  await expect(exerciseRow(page, 'Upper A', 'לחיצת חזה — גרסת העותק')).toBeVisible();

  await planPill(page, 'עוצמה Upper/Lower·').click();
  await expandWorkout(page, 'UA', 'Upper A');
  await expect(exerciseRow(page, 'Upper A', 'Barbell Bench Press')).toBeVisible();
  await expect(workoutCard(page, 'Upper A')).not.toContainText('גרסת העותק');

  expect(errors).toEqual([]);
});

test('switching the active plan switches the program the logger and dashboard use', async ({
  page,
}) => {
  const errors = failOnConsoleErrors(page);
  await openPlan(page);
  await planCard(page).getByLabel('שכפל').click();
  await planPill(page, /עותק/).click();
  await expect(page.getByRole('heading', { name: /— עותק$/ })).toBeVisible();

  // Give the copy a distinguishable workout so we can tell the two apart.
  await workoutCard(page, 'Upper A').getByLabel('ערוך').click();
  await textField(page, 'קוד (קצר)').fill('ZZ');
  await textField(page, 'שם').fill('Upper A — גרסה חדשה');
  await saveModal(page).click();
  await expect(workoutCard(page, 'גרסה חדשה')).toBeVisible();

  await planCard(page).getByRole('button', { name: 'הגדר כפעילה' }).click();
  // Exactly one plan is marked active, and it is the copy.
  const activePills = page.getByRole('button', { name: /· פעילה$/ });
  await expect(activePills).toHaveCount(1);
  await expect(activePills).toContainText('עותק');

  // The logger must now offer the copy's workouts, not the original's.
  await page.goto('/#/workout');
  await expect(page.getByRole('button', { name: 'ZZ', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'UA', exact: true })).toBeHidden();

  await page.goto('/#/');
  // The hero card splits the workout name on the em dash — code and short name
  // on one line, muscle groups beneath — so assert on the parts.
  const hero = page.locator('a[href="#/workout"]').first();
  await expect(hero).toContainText('ZZ');
  await expect(hero).toContainText('גרסה חדשה');

  expect(errors).toEqual([]);
});

test('a workout built from scratch round-trips every field through a reload', async ({ page }) => {
  const errors = failOnConsoleErrors(page);
  await openPlan(page);

  await addWorkoutBtn(page).click();
  await expect(workoutCard(page, 'אימון חדש')).toBeVisible();

  await workoutCard(page, 'אימון חדש').getByLabel('ערוך').click();
  await textField(page, 'קוד (קצר)').fill('PP');
  await textField(page, 'שם').fill('דחיפה — חזה · כתפיים · טריצפס');
  await numField(page, 'מנוחה ברירת מחדל (שניות)').fill('210');
  await saveModal(page).click();

  const pp = workoutCard(page, 'דחיפה');
  await expect(pp).toContainText('PP');
  await expect(pp).toContainText('3:30');

  await expandWorkout(page, 'PP', 'דחיפה');
  await pp.getByRole('button', { name: 'הוסף קבוצת שרירים' }).click();
  await pp.getByRole('button', { name: 'קבוצת שרירים חדשה' }).click();
  await pp.getByRole('textbox').fill('חזה עליון');
  await pp.getByRole('textbox').press('Enter');
  await expect(pp.getByRole('button', { name: 'חזה עליון' })).toBeVisible();

  await pp.getByRole('button', { name: 'הוסף תרגיל' }).click();
  await expect(exerciseRow(page, 'דחיפה', 'תרגיל חדש')).toBeVisible();
  await exerciseRow(page, 'דחיפה', 'תרגיל חדש').getByLabel('ערוך').click();
  await textField(page, 'שם תרגיל').fill('לחיצת חזה בשיפוע');
  await numField(page, 'סטים').fill('4');
  await numField(page, 'חזרות מינ׳').fill('8');
  await numField(page, 'חזרות מקס׳').fill('12');
  await numField(page, 'מנוחה (שניות)').fill('90');
  await numField(page, 'משקל מוט (kg, לפלטות)').fill('20');
  await numField(page, 'קפיצת משקל (kg)').fill('1.25');
  await page.getByRole('checkbox').check();
  await saveModal(page).click();
  await expect(exerciseRow(page, 'דחיפה', 'לחיצת חזה בשיפוע')).toContainText(
    '4×8-12 · מוט 20kg · מכונה',
  );

  // Everything must come back after a cold start, not just live in React state.
  await page.reload();
  await expandWorkout(page, 'PP', 'דחיפה');
  await exerciseRow(page, 'דחיפה', 'לחיצת חזה בשיפוע').getByLabel('ערוך').click();
  await expect(numField(page, 'סטים')).toHaveValue('4');
  await expect(numField(page, 'חזרות מינ׳')).toHaveValue('8');
  await expect(numField(page, 'חזרות מקס׳')).toHaveValue('12');
  await expect(numField(page, 'מנוחה (שניות)')).toHaveValue('90');
  await expect(numField(page, 'משקל מוט (kg, לפלטות)')).toHaveValue('20');
  await expect(numField(page, 'קפיצת משקל (kg)')).toHaveValue('1.25');
  await expect(page.getByRole('checkbox')).toBeChecked();

  expect(errors).toEqual([]);
});

test('out-of-range numbers are clamped, and קפיצת משקל can be cleared back to automatic', async ({
  page,
}) => {
  await openPlan(page);
  await expandWorkout(page, 'UA', 'Upper A');
  const bench = () => exerciseRow(page, 'Upper A', 'Barbell Bench Press');

  await bench().getByLabel('ערוך').click();
  await numField(page, 'קפיצת משקל (kg)').fill('5');
  await saveModal(page).click();
  await expect(bench()).toBeVisible();
  const withInc = await table<{ name: string; incrementKg?: number }>(page, 'exercises');
  expect(withInc.find((e) => e.name === 'Barbell Bench Press')?.incrementKg).toBe(5);

  // Clearing the field must remove the override, not store 0 (0 would mean
  // "never add weight" to the progression engine).
  await bench().getByLabel('ערוך').click();
  await expect(numField(page, 'קפיצת משקל (kg)')).toHaveValue('5');
  await numField(page, 'קפיצת משקל (kg)').fill('');
  await saveModal(page).click();
  await expect(bench()).toBeVisible();
  await expect
    .poll(async () => {
      const rows = await table<{ name: string; incrementKg?: number }>(page, 'exercises');
      return 'incrementKg' in (rows.find((e) => e.name === 'Barbell Bench Press') ?? {});
    })
    .toBe(false);

  // Negative / zero input must never reach the database.
  await bench().getByLabel('ערוך').click();
  await numField(page, 'סטים').fill('-5');
  await numField(page, 'חזרות מינ׳').fill('0');
  await numField(page, 'משקל מוט (kg, לפלטות)').fill('-20');
  await saveModal(page).click();
  await expect(bench()).toContainText('1×1-5');
  const clamped = (await table<{ name: string; targetSets: number; barWeight: number }>(
    page,
    'exercises',
  )).find((e) => e.name === 'Barbell Bench Press')!;
  expect(clamped.targetSets).toBe(1);
  expect(clamped.barWeight).toBe(0);
});

test('adding workouts after deleting one produces no code or order collisions', async ({
  page,
}) => {
  const errors = failOnConsoleErrors(page);
  await openPlan(page);

  await addWorkoutBtn(page).click();
  await expect(workoutCard(page, 'W5')).toBeVisible();
  await workoutCard(page, 'W5').getByLabel('מחק אימון').click();
  await confirmDelete(page).click();
  await expect(workoutCard(page, 'W5')).toBeHidden();

  await addWorkoutBtn(page).click();
  await expect(workoutCard(page, 'W5')).toBeVisible();
  await addWorkoutBtn(page).click();
  await expect(workoutCard(page, 'W6')).toBeVisible();

  const workouts = await table<{ code: string; order: number }>(page, 'workouts');
  expect(new Set(workouts.map((w) => w.code)).size).toBe(workouts.length);
  expect(new Set(workouts.map((w) => w.order)).size).toBe(workouts.length);

  // The logger addresses workouts by code, so a collision there would be fatal.
  await page.goto('/#/workout');
  for (const code of ['UA', 'LA', 'UB', 'LB', 'W5', 'W6']) {
    await expect(page.getByRole('button', { name: code, exact: true })).toHaveCount(1);
  }

  expect(errors).toEqual([]);
});

test('deleting a workout takes its muscle groups and exercises with it', async ({ page }) => {
  const errors = failOnConsoleErrors(page);
  await openPlan(page);
  expect(await table(page, 'muscleGroups')).toHaveLength(13);
  expect(await table(page, 'exercises')).toHaveLength(27);

  await workoutCard(page, 'Upper A').getByLabel('מחק אימון').click();
  await confirmDelete(page).click();
  await expect(workoutCard(page, 'Upper A')).toBeHidden();

  // Upper A owned 3 groups and 6 exercises — none may survive as orphans.
  await expect.poll(async () => (await table(page, 'muscleGroups')).length).toBe(10);
  expect(await table(page, 'exercises')).toHaveLength(21);
  const groupIds = new Set(
    (await table<{ id: string }>(page, 'muscleGroups')).map((g) => g.id),
  );
  for (const ex of await table<{ muscleGroupId: string }>(page, 'exercises')) {
    expect(groupIds.has(ex.muscleGroupId)).toBe(true);
  }

  // …and the deleted workout must not linger anywhere else.
  await page.goto('/#/workout');
  await expect(page.getByRole('button', { name: 'UA', exact: true })).toBeHidden();
  await page.goto('/#/');
  await expect(page.getByText('Upper A —')).toBeHidden();

  expect(errors).toEqual([]);
});

test('deleting a plan leaves no orphaned workouts, groups or exercises', async ({ page }) => {
  const errors = failOnConsoleErrors(page);
  await openPlan(page);

  await planCard(page).getByLabel('מחק תכנית').click();
  await expect(page.getByRole('dialog')).toContainText('תמחק את התכנית ואת כל האימונים שלה');
  await confirmDelete(page).click();

  await expect(page.getByText('אין תכניות')).toBeVisible();
  await expect.poll(async () => (await table(page, 'plans')).length).toBe(0);
  expect(await table(page, 'workouts')).toHaveLength(0);
  expect(await table(page, 'muscleGroups')).toHaveLength(0);
  expect(await table(page, 'exercises')).toHaveLength(0);

  await page.goto('/#/');
  await expect(page.getByText('אין תכנית פעילה')).toBeVisible();
  await expect(page.getByText('המשך טיוטה')).toBeHidden();

  // The first plan created into an empty database becomes the active one.
  await page.goto('/#/plan');
  await page.getByRole('button', { name: 'צרו תכנית' }).click();
  await expect(planPill(page, 'תכנית חדשה')).toContainText('פעילה');

  expect(errors).toEqual([]);
});

test('an edit made in the plan is what the logger shows next time the workout is opened', async ({
  page,
}) => {
  const errors = failOnConsoleErrors(page);
  await openPlan(page);
  await expandWorkout(page, 'UA', 'Upper A');

  await exerciseRow(page, 'Upper A', 'Barbell Bench Press').getByLabel('ערוך').click();
  await textField(page, 'שם תרגיל').fill('לחיצת חזה במוט');
  await numField(page, 'סטים').fill('2');
  await numField(page, 'מנוחה (שניות)').fill('120');
  await saveModal(page).click();
  await expect(exerciseRow(page, 'Upper A', 'לחיצת חזה במוט')).toBeVisible();

  // Delete a second exercise so the planned-set total has to be recomputed.
  await exerciseRow(page, 'Upper A', 'Lateral Raise').getByLabel('מחק תרגיל').click();
  await confirmDelete(page).click();
  await expect(exerciseRow(page, 'Upper A', 'Lateral Raise')).toBeHidden();

  await page.goto('/#/workout');
  await page.getByRole('button', { name: 'UA', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'לחיצת חזה במוט' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Barbell Bench Press' })).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Lateral Raise' })).toBeHidden();
  await expect(page.getByText('חזה · 2×3-5 · מנוחה 2:00')).toBeVisible();
  // 21 planned − 3 (bench 5→2) − 3 (lateral raise removed) = 15
  await expect(page.getByText('0 / 15 סטים')).toBeVisible();

  expect(errors).toEqual([]);
});

// --- regressions ------------------------------------------------------------
// Deleting a workout or a plan used to hard-delete its autosaved draft, taking
// logged-but-unsaved sets with it and removing the dashboard's rescue card —
// silently, and in the plan case under a dialog that promised the opposite.
// Empty drafts are still cleaned up; drafts holding work never are.

test('deleting a workout warns about, and preserves, an unsaved session', async ({ page }) => {
  await openWorkout(page);
  await logSet(page, 1, '60', '5');
  await logSet(page, 2, '60', '5');
  await page.getByLabel('תאריך האימון').fill('2026-07-24');
  await page.goto('/#/');
  await expect(page.getByText('אימון שלא נשמר')).toBeVisible();

  await openPlan(page);
  await workoutCard(page, 'Upper A').getByLabel('מחק אימון').click();
  await expect(page.getByRole('dialog')).toContainText('2 סטים');
  await confirmDelete(page).click();

  await page.goto('/#/');
  await expect(page.getByText('אימון שלא נשמר')).toBeVisible();
  // …and it can still be committed to history without its workout.
  await page.getByRole('button', { name: 'שמור עכשיו' }).click();
  await expect(page.getByText(/האימון נשמר · ציון/)).toBeVisible();
});

test('deleting a plan warns about, and preserves, an unsaved session', async ({ page }) => {
  await openWorkout(page);
  await logSet(page, 1, '60', '5');
  await page.getByLabel('תאריך האימון').fill('2026-07-24');
  await page.goto('/#/');
  await expect(page.getByText('אימון שלא נשמר')).toBeVisible();

  await openPlan(page);
  await planCard(page).getByLabel('מחק תכנית').click();
  await expect(page.getByRole('dialog')).toContainText('1 סטים');
  await confirmDelete(page).click();

  await expect.poll(async () => (await table(page, 'workoutDrafts')).length).toBe(1);
});

test('an empty draft is still cleaned up when its workout is deleted', async ({ page }) => {
  await openWorkout(page);
  // Typed but never ticked — nothing was confirmed, so nothing is at stake.
  await weightBox(page, 1).fill('60');
  await openPlan(page);
  await workoutCard(page, 'Upper A').getByLabel('מחק אימון').click();
  await expect(page.getByRole('dialog')).not.toContainText('סטים שטרם נשמרו');
  await confirmDelete(page).click();
  await expect.poll(async () => (await table(page, 'workoutDrafts')).length).toBe(0);
});

test('deleting the active plan promotes another one', async ({ page }) => {
  await openPlan(page);
  await addPlanBtn(page).click();
  await planPill(page, 'עוצמה').click();
  await planCard(page).getByLabel('מחק תכנית').click();
  await confirmDelete(page).click();

  const plans = await table<{ isActive: boolean }>(page, 'plans');
  expect(plans).toHaveLength(1);
  expect(plans.filter((p) => p.isActive)).toHaveLength(1);
});

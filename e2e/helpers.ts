import { expect, type Page } from '@playwright/test';

/**
 * Shared E2E vocabulary. Every test gets a fresh browser context, so IndexedDB
 * starts empty and the app re-seeds the "עוצמה Upper/Lower" program on first paint.
 *
 * Controls are found by their Hebrew accessible names — the same strings a
 * VoiceOver user hears. If a selector here stops matching, that is usually a
 * real accessibility regression, not a test that needs loosening.
 */

/** UA, first exercise: 5 sets × 3-5 reps, barbell. */
export const BENCH = 'Barbell Bench Press';

export const weightBox = (page: Page, set: number, exercise = BENCH) =>
  page.getByLabel(`משקל · ${exercise} · סט ${set}`);

export const repsBox = (page: Page, set: number, exercise = BENCH) =>
  page.getByLabel(`חזרות · ${exercise} · סט ${set}`);

/** The ✓ button for a set. Its label changes with state, so match either form. */
export const tickButton = (page: Page, set: number, exercise = BENCH) =>
  page.getByLabel(new RegExp(`^(סמן|סמן לפי היעד|בטל סימון) · ${escapeRe(exercise)} · סט ${set}$`));

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function openWorkout(page: Page, code = 'UA', firstExercise = BENCH) {
  await page.goto('/#/workout');
  await page.getByRole('button', { name: code, exact: true }).click();
  await expect(page.getByRole('heading', { name: firstExercise })).toBeVisible();
}

/** Fill weight+reps for one set row and tick it. */
export async function logSet(
  page: Page,
  set: number,
  weight: string,
  reps: string,
  exercise = BENCH,
) {
  await weightBox(page, set, exercise).fill(weight);
  await repsBox(page, set, exercise).fill(reps);
  await tickButton(page, set, exercise).click();
}

/** Walk Finish & Save through the incomplete-workout warning to a committed session. */
export async function finishAndSave(page: Page) {
  await page.getByRole('button', { name: 'סיים ושמור' }).click();
  const saveAnyway = page.getByRole('button', { name: 'שמור בכל זאת' });
  if (await saveAnyway.isVisible().catch(() => false)) await saveAnyway.click();
  await page.getByRole('button', { name: 'שמור אימון' }).click();
  await expect(page.getByText('האימון נשמר')).toBeVisible();
  await page.getByRole('button', { name: 'עבור להתקדמות' }).click();
}

/** Fail the test if the app logged anything to console.error during the run. */
export function failOnConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

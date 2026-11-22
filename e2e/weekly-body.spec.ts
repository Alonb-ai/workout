import { test, expect, type Page } from '@playwright/test';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openWorkout, logSet, finishAndSave, failOnConsoleErrors } from './helpers';

/**
 * Weekly summary and the body page's tape measurements + progress photos.
 * Photos are the one piece of body data that can't be re-typed from memory, so
 * the test follows one all the way into the backup file.
 */

const pad = (n: number) => String(n).padStart(2, '0');
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function benchSession(page: Page, date: string, weight: string) {
  await openWorkout(page);
  await page.getByLabel('תאריך האימון').fill(date);
  for (let i = 1; i <= 5; i++) await logSet(page, i, weight, '5');
  await finishAndSave(page);
}

/** 1×1 PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64',
);

test('weekly summary counts the week and names a heavier bench as a PR', async ({ page }) => {
  const errors = failOnConsoleErrors(page);
  // Seven days back is always last week; today is always this week.
  await benchSession(page, daysAgo(7), '60');
  await benchSession(page, daysAgo(0), '62.5');

  await page.goto('/#/progress');
  await page.getByRole('link', { name: 'סיכום שבועי' }).click();
  await expect(page.getByText('השבוע הנוכחי · עד עכשיו')).toBeVisible();

  const summary = page.getByLabel('סיכום השבוע');
  await expect(summary.locator('.field').filter({ hasText: 'אימונים' })).toContainText('1');
  await expect(summary.locator('.field').filter({ hasText: 'סטים' })).toContainText('5');
  await expect(page.getByText('שיאים · 1')).toBeVisible();
  await expect(page.getByText('משקל שיא')).toBeVisible();
  await expect(page.getByText('62.5 × 5/5/5/5/5')).toBeVisible();

  // Last week: one session, no PR (a first outing never is one).
  await page.getByRole('button', { name: 'שבוע קודם' }).click();
  await expect(page.getByText('ראשון עד שבת')).toBeVisible();
  await expect(page.getByText(/^שיאים/)).toHaveCount(0);
  await expect(summary.locator('.field').filter({ hasText: 'אימונים' })).toContainText('1');
  await page.getByRole('button', { name: 'חזרה לשבוע הנוכחי' }).click();
  await expect(page.getByText('שיאים · 1')).toBeVisible();

  // Reachable from the dashboard too.
  await page.goto('/#/');
  await page.getByRole('link', { name: /סיכום שבועי/ }).click();
  await expect(page.getByText('השבוע הנוכחי · עד עכשיו')).toBeVisible();

  expect(errors).toEqual([]);
});

test('waist and a progress photo survive a reload and reach the backup file', async ({ page }) => {
  const errors = failOnConsoleErrors(page);
  await page.goto('/#/body');
  await page.getByRole('button', { name: 'מדידה', exact: true }).click();
  await page.getByLabel('תאריך', { exact: true }).fill(daysAgo(14));
  await page.getByLabel('משקל גוף (kg)').fill('83');
  await page.getByLabel('היקף מותניים (ס״מ)').fill('90');
  await page.getByRole('button', { name: 'שמור', exact: true }).click();
  await expect(page.getByText('מדידה חדשה')).toBeHidden();

  await page.getByRole('button', { name: 'מדידה', exact: true }).click();
  await page.getByLabel('משקל גוף (kg)').fill('82');
  await page.getByLabel('היקף מותניים (ס״מ)').fill('88.5');
  await page
    .getByLabel('תמונת חזית', { exact: true })
    .locator('input[type=file]')
    .setInputFiles({ name: 'front.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByRole('img', { name: 'תמונת חזית' })).toBeVisible();
  await page.getByRole('button', { name: 'שמור', exact: true }).click();
  await expect(page.getByText('מדידה חדשה')).toBeHidden();

  await page.reload();
  // Circumference chip shows the latest value and the change since the first.
  const waist = page.getByRole('tab', { name: /מותניים/ });
  await expect(waist).toContainText('88.5');
  await expect(waist).toContainText('−1.5');
  await expect(page.getByRole('button', { name: /^הגדל תמונה/ })).toBeVisible();
  await expect(page.getByText('תמונה אחת')).toBeVisible();

  // A typo is refused, not clamped.
  await page.getByRole('button', { name: 'מדידה', exact: true }).click();
  await page.getByLabel('משקל גוף (kg)').fill('82');
  await page.getByLabel('היקף זרוע (ס״מ)').fill('380');
  await page.getByRole('button', { name: 'שמור', exact: true }).click();
  await expect(page.getByText('היקף זרוע חייב להיות בין 15 ל-70 ס״מ')).toBeVisible();
  await page.getByRole('button', { name: 'ביטול' }).click();

  await page.goto('/#/settings');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /ייצוא לקובץ/ }).click(),
  ]);
  const path = join(mkdtempSync(join(tmpdir(), 'iron-track-e2e-')), 'backup.json');
  await download.saveAs(path);
  const json = JSON.parse(readFileSync(path, 'utf8')) as {
    tables: { bodyMeasurements: { waistCm?: number; photos?: { pose: string; dataUrl: string }[] }[] };
  };
  const withPhoto = json.tables.bodyMeasurements.find((m) => (m.photos?.length ?? 0) > 0);
  expect(withPhoto?.waistCm).toBe(88.5);
  expect(withPhoto?.photos?.[0]?.pose).toBe('front');
  expect(withPhoto?.photos?.[0]?.dataUrl).toMatch(/^data:image\/jpeg;base64,/);

  expect(errors).toEqual([]);
});

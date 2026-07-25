import { test, expect, type Page } from '@playwright/test';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
 * "data" area: everything that has to still be there tomorrow — the backup
 * round-trip, supplements, body measurements, and the plate inventory that the
 * plate calculator reads. Local helpers only; ./helpers.ts is shared.
 */

const SUP_NAME_PH = 'למשל: קריאטין, ויטמין D3, מגנזיום';

async function addSupplement(page: Page, name: string, times: string[]) {
  await page.goto('/#/supplements');
  await page.getByRole('button', { name: 'תוסף', exact: true }).click();
  await expect(page.getByText('תוסף חדש')).toBeVisible();
  await page.getByPlaceholder(SUP_NAME_PH).fill(name);
  // Fill each slot before adding the next: "הוסף שעה" always proposes 12:00 and
  // refuses to add a duplicate of a time already in the list.
  for (let i = 0; i < times.length; i++) {
    if (i > 0) await page.getByRole('button', { name: 'הוסף שעה' }).click();
    await page.getByLabel(`שעה ${i + 1}`).fill(times[i]!);
  }
  await page.getByRole('button', { name: 'שמור', exact: true }).click();
  await expect(page.getByText('תוסף חדש')).toBeHidden();
}

async function addMeasurement(
  page: Page,
  m: { date: string; weight: string; fat?: string; muscle?: string },
) {
  await page.goto('/#/body');
  await page.getByRole('button', { name: 'מדידה', exact: true }).click();
  await expect(page.getByText('מדידה חדשה')).toBeVisible();
  await page.getByLabel('תאריך', { exact: true }).fill(m.date);
  await page.getByLabel('משקל גוף (kg)').fill(m.weight);
  if (m.fat) await page.getByLabel('אחוז שומן').fill(m.fat);
  if (m.muscle) await page.getByLabel('מסת שריר (kg)').fill(m.muscle);
  await page.getByRole('button', { name: 'שמור', exact: true }).click();
  await expect(page.getByText('מדידה חדשה')).toBeHidden();
}

/** Click "ייצוא לקובץ" and return the parsed backup plus a path on disk. */
async function exportBackup(page: Page): Promise<{ json: BackupFile; path: string }> {
  await page.goto('/#/settings');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /ייצוא לקובץ/ }).click(),
  ]);
  const dir = mkdtempSync(join(tmpdir(), 'iron-track-e2e-'));
  const path = join(dir, download.suggestedFilename() || 'backup.json');
  await download.saveAs(path);
  return { json: JSON.parse(readFileSync(path, 'utf8')) as BackupFile, path };
}

interface BackupFile {
  version: number;
  exportedAt: number;
  tables: Record<string, Record<string, unknown>[]>;
}

async function importFile(page: Page, path: string) {
  await page.goto('/#/settings');
  await page.locator('input[type=file]').setInputFiles(path);
  await expect(page.getByText('ייבוא נתונים')).toBeVisible();
  await page.getByRole('button', { name: /ייבא והחלף/ }).click();
}

async function wipeEverything(page: Page) {
  await page.goto('/#/settings');
  await page.getByRole('button', { name: /אפס את כל הנתונים/ }).click();
  await page.getByRole('button', { name: 'איפוס', exact: true }).click();
  await expect(page.getByText('האפליקציה אופסה')).toBeVisible();
}

/** The section whose <h2> is `title` — the pages repeat time strings across lists. */
const section = (page: Page, title: string) =>
  page.locator('section').filter({ has: page.getByRole('heading', { name: title, exact: true }) });

/**
 * The dose timeline on /supplements, whichever day is being viewed. Matched on
 * its description rather than its heading, which is the (variable) date.
 */
const timeline = (page: Page) =>
  page.locator('section').filter({ hasText: /לוח הזמנים של המנות להיום|סימון רטרואקטיבי/ });

/** One row of the supplement timeline, identified by its scheduled time. */
const doseRow = (page: Page, time: string) =>
  timeline(page).getByRole('listitem').filter({ hasText: time });

function tempJson(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'iron-track-e2e-'));
  const p = join(dir, name);
  writeFileSync(p, content, 'utf8');
  return p;
}

// ---------------------------------------------------------------------------

test('a backup round-trips a session, a body measurement and a supplement', async ({ page }) => {
  // A realistic day: train, weigh in, take the creatine.
  await openWorkout(page);
  for (let i = 1; i <= 5; i++) await logSet(page, i, '60', '5');
  await finishAndSave(page);

  await addMeasurement(page, { date: '2026-07-20', weight: '82.4', fat: '18.5' });
  await addSupplement(page, 'קריאטין', ['08:00']);
  await page.getByRole('button', { name: 'נלקח', exact: true }).click();
  await expect(page.getByLabel('נלקח · לחץ לאיפוס')).toBeVisible();

  const { json, path } = await exportBackup(page);

  // The file itself must contain the data, not just "some JSON".
  expect(json.tables.sessions).toHaveLength(1);
  expect(json.tables.setLogs).toHaveLength(5);
  expect(json.tables.bodyMeasurements).toHaveLength(1);
  expect(json.tables.bodyMeasurements![0]!.bodyWeight).toBe(82.4);
  expect(json.tables.supplements).toHaveLength(1);
  expect(json.tables.supplements![0]!.name).toBe('קריאטין');
  expect(json.tables.supplementLogs).toHaveLength(1);
  expect(json.tables.supplementLogs![0]!.status).toBe('taken');

  await wipeEverything(page);

  // Gone, all three of them.
  await page.goto('/#/');
  await expect(page.getByText('הוסף מדידת גוף ראשונה')).toBeVisible();
  await expect(page.getByText('לא הוגדרו תוספים')).toBeVisible();
  await page.goto('/#/progress');
  await expect(page.getByText('אין עדיין אימונים').or(page.getByText('אין אימונים'))).toBeVisible();

  await importFile(page, path);
  await expect(page.getByText('הייבוא הושלם')).toBeVisible();

  // …and back, all three of them.
  await page.goto('/#/body');
  await expect(page.getByText('82.4 kg').first()).toBeVisible();
  await page.goto('/#/supplements');
  await expect(page.getByText('קריאטין').first()).toBeVisible();
  await expect(page.getByLabel('נלקח · לחץ לאיפוס')).toBeVisible();
  await page.goto('/#/progress');
  await expect(page.getByText('Upper A').first()).toBeVisible();
});

test('a JSON file that is not an Iron Track backup is refused, and wipes nothing', async ({ page }) => {
  await addMeasurement(page, { date: '2026-07-22', weight: '80.0' });
  await addSupplement(page, 'מגנזיום', ['21:00']);

  const junk = tempJson('hello.json', JSON.stringify({ hello: 'world' }));
  await importFile(page, junk);
  await expect(page.getByText('הקובץ אינו גיבוי של Iron Track')).toBeVisible();

  // A structurally valid but empty backup is refused too — importing it would
  // be indistinguishable from a wipe.
  const empty = tempJson(
    'empty.json',
    JSON.stringify({ version: 4, exportedAt: 0, tables: { plans: [], exercises: [], sessions: [] } }),
  );
  await page.getByRole('button', { name: 'ביטול' }).click();
  await importFile(page, empty);
  await expect(page.getByText('הגיבוי ריק — לא בוצע שינוי')).toBeVisible();
  await page.getByRole('button', { name: 'ביטול' }).click();

  // Nothing was touched by either attempt.
  await page.goto('/#/body');
  await expect(page.getByText('80.0 kg').first()).toBeVisible();
  await page.goto('/#/supplements');
  await expect(page.getByText('מגנזיום').first()).toBeVisible();
  await page.goto('/#/workout');
  await expect(page.getByRole('button', { name: 'UA', exact: true })).toBeVisible();
});

test('a supplement with three daily doses tracks taken / skipped / pending, and the dashboard agrees', async ({ page }) => {
  const errors = failOnConsoleErrors(page);
  await addSupplement(page, 'אומגה 3', ['08:00', '14:00', '21:00']);

  await expect(section(page, 'היום').getByRole('listitem')).toHaveCount(3);
  await doseRow(page, '08:00').getByLabel('נלקח', { exact: true }).click();
  await doseRow(page, '14:00').getByLabel('דלג', { exact: true }).click();

  await expect(doseRow(page, '08:00').getByLabel('נלקח · לחץ לאיפוס')).toBeVisible();
  await expect(doseRow(page, '14:00').getByLabel('סמן כנלקח')).toBeVisible();
  await expect(doseRow(page, '21:00').getByLabel('נלקח', { exact: true })).toBeVisible();

  // The dashboard is the screen he actually looks at in the morning.
  await page.goto('/#/');
  const dash = section(page, 'תוספים להיום');
  await expect(dash.getByRole('listitem')).toHaveCount(3);
  await expect(dash.getByRole('listitem').filter({ hasText: '08:00' })).toContainText('נלקח');
  await expect(dash.getByRole('listitem').filter({ hasText: '14:00' })).toContainText('דולג');
  await expect(dash.getByRole('listitem').filter({ hasText: '21:00' })).toContainText('ממתין');

  // Marks survive a cold reload, not just a route change.
  await page.reload();
  await expect(section(page, 'תוספים להיום').getByRole('listitem').filter({ hasText: '08:00' })).toContainText('נלקח');
  expect(errors).toEqual([]);
});

test('adherence scores only days the supplement already existed', async ({ page }) => {
  await addSupplement(page, 'ויטמין D3', ['08:00']);

  // Age the supplement by three days through the backup file — the only way to
  // get "history" without waiting three days.
  const { json, path } = await exportBackup(page);
  json.tables.supplements![0]!.createdAt = Date.now() - 3 * 86_400_000;
  writeFileSync(path, JSON.stringify(json), 'utf8');
  await importFile(page, path);
  await expect(page.getByText('הייבוא הושלם')).toBeVisible();
  await page.goto('/#/supplements');

  const adh = section(page, 'היענות (30 ימים)');
  // Back-fill yesterday from the day navigator. Scorable days are yesterday, -2
  // and -3 (today is excluded — its doses can still happen; -4 and older predate
  // the supplement). 1 of 3 → 33%. Counting days before creation would read 14%.
  await page.getByLabel('יום קודם').click();
  await expect(page.getByRole('heading', { name: 'אתמול', exact: true })).toBeVisible();
  await doseRow(page, '08:00').getByLabel('נלקח', { exact: true }).click();
  await expect(doseRow(page, '08:00').getByLabel('נלקח · לחץ לאיפוס')).toBeVisible();
  await expect(adh.getByText('33%').first()).toBeVisible();
  await expect(adh.getByText('14%')).toHaveCount(0);

  // Back-fill the other two days → a perfect record.
  for (let i = 0; i < 2; i++) {
    await page.getByLabel('יום קודם').click();
    await doseRow(page, '08:00').getByLabel('נלקח', { exact: true }).click();
    await expect(doseRow(page, '08:00').getByLabel('נלקח · לחץ לאיפוס')).toBeVisible();
  }
  await expect(adh.getByText('100%').first()).toBeVisible();

  // A supplement added TODAY must not retroactively fail those same days.
  // If it were counted, each of them would drop to 1-of-2 and the figure to 50%.
  await addSupplement(page, 'קריאטין', ['09:00']);
  await expect(section(page, 'היענות (30 ימים)').getByText('100%').first()).toBeVisible();
  await expect(section(page, 'היענות (30 ימים)').getByText('50%')).toHaveCount(0);
});

test('two measurements on one date agree between the body page and the dashboard, and survive a reload', async ({ page }) => {
  const errors = failOnConsoleErrors(page);
  await addMeasurement(page, { date: '2026-07-21', weight: '80.0', fat: '20' });
  await addMeasurement(page, { date: '2026-07-21', weight: '85.5', fat: '18' });

  const latestCard = page.locator('section').filter({ hasText: 'מדידה אחרונה' }).first();
  await expect(latestCard).toContainText('85.5');
  await expect(page.getByText('2 מדידות')).toBeVisible();

  await page.goto('/#/');
  const bodyChip = page.locator('section').filter({ hasText: 'גוף' }).last();
  await expect(bodyChip).toContainText('85.5');

  // Editing the older row must not steal "latest" from the newer one.
  await page.goto('/#/body');
  await page.getByRole('listitem').filter({ hasText: '80.0 kg' }).getByLabel('ערוך').click();
  await page.getByLabel('משקל גוף (kg)').fill('79.2');
  await page.getByRole('button', { name: 'שמור', exact: true }).click();
  await expect(page.getByText('מדידה עודכנה')).toBeVisible();

  await page.reload();
  await expect(page.locator('section').filter({ hasText: 'מדידה אחרונה' }).first()).toContainText('85.5');
  await expect(page.getByRole('listitem').filter({ hasText: '79.2 kg' })).toBeVisible();
  await page.goto('/#/');
  await expect(page.locator('section').filter({ hasText: 'גוף' }).last()).toContainText('85.5');
  expect(errors).toEqual([]);
});

test('absurd body numbers are refused, not silently rewritten', async ({ page }) => {
  await page.goto('/#/body');
  await page.getByRole('button', { name: 'מדידה', exact: true }).click();

  // Empty weight is refused.
  await page.getByRole('button', { name: 'שמור', exact: true }).click();
  await expect(page.getByText('משקל גוף חייב להיות בין 20 ל-300 ק״ג').first()).toBeVisible();

  // A typed 0 used to be clamped up to the input's min and saved as a real
  // 20.0 kg measurement, with a success toast. It must be refused instead.
  await page.getByLabel('משקל גוף (kg)').fill('0');
  await page.getByRole('button', { name: 'שמור', exact: true }).click();
  await expect(page.getByText('משקל גוף חייב להיות בין 20 ל-300 ק״ג').first()).toBeVisible();
  await expect(page.getByText('מדידה נשמרה')).toHaveCount(0);

  // Out-of-range extras are refused too, each with its own reason.
  await page.getByLabel('משקל גוף (kg)').fill('85');
  await page.getByLabel('אחוז שומן').fill('200');
  await page.getByRole('button', { name: 'שמור', exact: true }).click();
  await expect(page.getByText('אחוז שומן חייב להיות בין 3 ל-60')).toBeVisible();

  // Nothing was written by any of the refused attempts.
  await page.goto('/#/body');
  await expect(page.getByText('20.0 kg')).toHaveCount(0);
  await expect(page.getByText('500.0 kg')).toHaveCount(0);
});

test('the plate calculator loads only plates the inventory says he owns, in pairs', async ({ page }) => {
  const errors = failOnConsoleErrors(page);
  await openWorkout(page);

  // The seeded program ships every exercise with barWeight 0, so give the bench
  // a real 20 kg bar first — otherwise there is nothing to calculate.
  await page.getByLabel('פעולות').first().click();
  await page.getByRole('button', { name: 'מוט וקפיצת משקל' }).click();
  const loadDialog = page.getByRole('dialog');
  // The "משקל המוט" label is not wired to its input, so go by position.
  await loadDialog.locator('input[inputmode=decimal]').first().fill('20');
  await page.getByRole('button', { name: 'שמור', exact: true }).click();

  await weightBox(page, 1).fill('62.5');
  await page.getByLabel(`חישוב פלטות · ${BENCH} · סט 1`).click();
  const calc = page.getByRole('dialog');
  await expect(page.getByText('פלטות בכל צד (מהגדולה לקטנה)')).toBeVisible();
  // 20 + 10 + 1.25 per side = 62.5 net, on top of a 20 kg bar = 82.50 total.
  await expect(calc).toContainText('82.50');
  await expect(calc).toContainText('✓ מדויק');
  await expect(calc).toContainText('1.25');
  await page.keyboard.press('Escape');

  // He owns exactly one 1.25 plate — a single plate cannot be loaded, plates go
  // on in pairs. The calculator must stop offering it.
  await page.goto('/#/settings');
  await page.getByLabel('כמות פלטות של 1.25 ק״ג').fill('1');
  await page.getByLabel('משקל פלטה (kg)').first().click(); // blur → commit

  await openWorkout(page);
  await weightBox(page, 1).fill('62.5');
  await page.getByLabel(`חישוב פלטות · ${BENCH} · סט 1`).click();
  const calc2 = page.getByRole('dialog');
  await expect(calc2).toContainText('80.00'); // 20 + 10 per side + 20 kg bar
  await expect(calc2).toContainText('-2.50');
  await expect(calc2).not.toContainText('✓ מדויק');
  expect(errors).toEqual([]);
});

test('a very long Hebrew supplement name and duplicate times do not break the timeline', async ({ page }) => {
  const errors = failOnConsoleErrors(page);
  const longName = 'מגנזיום ציטראט בשחרור מושהה עם ויטמין B6 ואבץ כלאט לספיגה מיטבית לפני השינה';
  await page.goto('/#/supplements');
  await page.getByRole('button', { name: 'תוסף', exact: true }).click();
  await page.getByPlaceholder(SUP_NAME_PH).fill(longName);
  // Two slots holding the same hour — the same-day duplicate case.
  await page.getByRole('button', { name: 'הוסף שעה' }).click();
  await page.getByLabel('שעה 2').fill('08:00');
  await page.getByRole('button', { name: 'שמור', exact: true }).click();
  await expect(page.getByText('תוסף חדש')).toBeHidden();

  // One dose, not two rows sharing one log.
  await expect(section(page, 'היום').getByRole('listitem')).toHaveCount(1);
  await doseRow(page, '08:00').getByLabel('נלקח', { exact: true }).click();
  await expect(doseRow(page, '08:00').getByLabel('נלקח · לחץ לאיפוס')).toBeVisible();

  // The long name must not push the page into horizontal scroll.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('an unfinished workout is inside the backup and comes back with it', async ({ page }) => {
  // Losing a session he forgot to save is the failure the whole app is built
  // around, so the draft has to be part of "my data", not just finished sessions.
  await openWorkout(page);
  await logSet(page, 1, '60', '5');
  await logSet(page, 2, '60', '4');
  await expect(page.getByText('2 / 21 סטים')).toBeVisible();

  const { json, path } = await exportBackup(page);
  expect(json.tables.workoutDrafts).toHaveLength(1);

  await wipeEverything(page);
  await page.goto('/#/');
  await expect(page.getByText('המשך טיוטה')).toHaveCount(0);

  await importFile(page, path);
  await expect(page.getByText('הייבוא הושלם')).toBeVisible();

  await page.goto('/#/');
  await expect(page.getByText('המשך טיוטה')).toBeVisible();
  await expect(page.getByText('2/21 סטים')).toBeVisible();
  await page.goto('/#/workout');
  await page.getByRole('button', { name: 'UA', exact: true }).click();
  await expect(weightBox(page, 1)).toHaveValue('60');
  await expect(repsBox(page, 2)).toHaveValue('4');
});

// Regression: a backup with no `settings` row (older or hand-edited file) left
// `seeded: false` after the import, so the next boot seeded a SECOND copy of
// the default program on top of the restored one — two plans, both active.
test('importing a backup without a settings table does not duplicate the program', async ({
  page,
}) => {
  await openWorkout(page);
  for (let i = 1; i <= 5; i++) await logSet(page, i, '60', '5');
  await finishAndSave(page);

  const { json, path } = await exportBackup(page);
  delete json.tables.settings;
  writeFileSync(path, JSON.stringify(json), 'utf8');

  await importFile(page, path);
  await expect(page.getByText('הייבוא הושלם')).toBeVisible();
  await page.reload();

  await page.goto('/#/plan');
  await expect(page.getByRole('heading', { name: 'עוצמה Upper/Lower' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^עוצמה Upper\/Lower/ })).toHaveCount(1);
});

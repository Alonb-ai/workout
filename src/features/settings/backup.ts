import { db } from '@/db/db';
import { ensureSettings } from '@/db/seed';

/**
 * Backup/restore/wipe are all driven off `db.tables` rather than a hand-written
 * list of table names. Every hand-listed version of this file silently forgot a
 * table that a later `.version()` had added — body measurements were missing
 * from every export ever taken, and "reset all data" left them behind.
 */
export interface ExportPayload {
  /** Dexie schema version the backup was taken at. */
  version: number;
  exportedAt: number;
  /** Table name → rows. Covers every table in the schema, always. */
  tables: Record<string, unknown[]>;
}

export async function exportAll(): Promise<ExportPayload> {
  const entries = await Promise.all(
    db.tables.map(async (t) => [t.name, await t.toArray()] as const),
  );
  return {
    version: db.verno,
    exportedAt: Date.now(),
    tables: Object.fromEntries(entries),
  };
}

/**
 * Pull the table rows out of a backup file. Accepts the current
 * `{ tables: { … } }` shape and the older flat one (`{ plans: [], … }`) so
 * backups taken before this change still restore.
 */
function readTables(raw: unknown): Record<string, unknown[]> {
  const data = (raw ?? {}) as Record<string, unknown>;
  const src = (
    data.tables && typeof data.tables === 'object' ? data.tables : data
  ) as Record<string, unknown>;
  const out: Record<string, unknown[]> = {};
  for (const t of db.tables) {
    const rows = src[t.name];
    if (Array.isArray(rows)) out[t.name] = rows;
  }
  return out;
}

/** Row counts per table, for the pre-import confirmation screen. */
export function summarizeBackup(raw: unknown): Record<string, number> {
  const tables = readTables(raw);
  return Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length]));
}

export async function importAll(rawData: unknown): Promise<void> {
  const tables = readTables(rawData);

  // Validate BEFORE touching the database. The old version cleared all ten
  // tables first and coerced anything unrecognised to [], so importing a
  // random JSON file wiped everything and reported success.
  if (!tables.plans || !tables.exercises || !tables.sessions) {
    throw new Error('הקובץ אינו גיבוי של Iron Track');
  }
  if (Object.values(tables).every((rows) => rows.length === 0)) {
    throw new Error('הגיבוי ריק — לא בוצע שינוי');
  }

  await db.transaction('rw', db.tables, async () => {
    for (const t of db.tables) {
      await t.clear();
      const rows = tables[t.name];
      if (rows && rows.length > 0) await t.bulkAdd(rows as never);
    }
  });
  await ensureSettings();
  // A backup without a `settings` row (older or hand-edited file) would leave
  // `seeded: false`, and the next boot would seed a SECOND copy of the default
  // program on top of the imported one — two plans, both flagged active.
  // Importing plans is proof enough that this database is already set up.
  if ((tables.plans?.length ?? 0) > 0) {
    await db.settings.update('singleton', { seeded: true });
  }
}

export async function wipeAll(): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    for (const t of db.tables) await t.clear();
  });
}

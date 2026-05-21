import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import { DEFAULT_SETTINGS, ensureSettings } from '@/db/seed';
import type { AppSettings } from '@/types';

/** Live-reactive settings. Falls back to defaults until the singleton row is written. */
export function useSettings(): AppSettings {
  const s = useLiveQuery(() => db.settings.get('singleton'), []);
  return s ?? DEFAULT_SETTINGS;
}

export async function updateSettings(patch: Partial<AppSettings>): Promise<void> {
  const cur = await ensureSettings();
  await db.settings.put({ ...cur, ...patch });
}

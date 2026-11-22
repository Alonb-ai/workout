import { registerPlugin } from '@capacitor/core';
import { liveQuery } from 'dexie';
import { db } from '@/db/db';
import type { SessionBundle } from '@/utils/summaryText';
import {
  buildWeeklySummary,
  buildWorkoutSummary,
  latestCompleted,
  previousAttempts,
  weekStartISO,
} from '@/utils/summaryText';

/**
 * Feeds the iOS Shortcuts actions "סיכום האימון האחרון" / "סיכום שבועי"
 * (`ios/App/App/SummaryShortcuts.swift`).
 *
 * The data lives in the web view's IndexedDB, which Swift cannot read, so the
 * web layer renders both summaries and hands the text to native storage
 * (UserDefaults) whenever sessions change or the app comes to the foreground.
 * A Shortcut can then read them without opening the app — e.g. a weekly
 * automation that mails the summary to an AI assistant.
 */
interface SummaryStorePlugin {
  save(options: {
    lastWorkout: string;
    weekly: string;
    /** Sunday of the week `weekly` covers (yyyy-MM-dd). */
    weekStart: string;
    updatedAt: number;
  }): Promise<void>;
}

const SummaryStore = registerPlugin<SummaryStorePlugin>('SummaryStore');

async function loadBundles(): Promise<SessionBundle[]> {
  const [sessions, exLogs, setLogs] = await Promise.all([
    db.sessions.where('status').equals('completed').toArray(),
    db.exerciseLogs.toArray(),
    db.setLogs.toArray(),
  ]);
  const setsByLog = new Map<string, typeof setLogs>();
  for (const s of setLogs) {
    const arr = setsByLog.get(s.exerciseLogId);
    if (arr) arr.push(s);
    else setsByLog.set(s.exerciseLogId, [s]);
  }
  const bySession = new Map<string, SessionBundle>();
  for (const session of sessions) bySession.set(session.id, { session, exercises: [] });
  for (const log of exLogs) {
    bySession.get(log.sessionId)?.exercises.push({ log, sets: setsByLog.get(log.id) ?? [] });
  }
  return [...bySession.values()];
}

export function renderSummaries(
  bundles: SessionBundle[],
  now: Date = new Date(),
): { lastWorkout: string; weekly: string; weekStart: string } {
  const last = latestCompleted(bundles);
  const weekStart = weekStartISO(now);
  return {
    lastWorkout: last
      ? buildWorkoutSummary(last, previousAttempts(last, bundles))
      : 'עדיין לא נשמרו אימונים.',
    weekly: buildWeeklySummary(bundles, weekStart),
    weekStart,
  };
}

let started = false;

export function startShortcutSummaries(): void {
  if (started) return;
  started = true;

  let latest: SessionBundle[] | null = null;
  const push = () => {
    if (!latest) return;
    const r = renderSummaries(latest);
    SummaryStore.save({ ...r, updatedAt: Date.now() }).catch((err: unknown) => {
      console.warn('SummaryStore.save failed', err);
    });
  };

  // Re-renders after every saved / edited / deleted session.
  liveQuery(loadBundles).subscribe({
    next: (b) => {
      latest = b;
      push();
    },
    error: (err: unknown) => console.warn('summary query failed', err),
  });

  // The weekly text depends on today's date, not only on the data: refresh it
  // whenever the app is opened, so a new week doesn't keep last week's text.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') push();
  });
}

import type { WorkoutDraft } from './types';

/**
 * "You left a workout open" reminders.
 *
 * The owner's worst experience with the app is finding out days later that a
 * workout was never saved. The draft already keeps the sets safe; this decides
 * when to nudge him to actually press Save.
 *
 * The clock runs from the draft's LAST change (`updatedAt`), not from when the
 * workout started: a long session that is still being logged is not forgotten,
 * but one that has been silent for two hours almost certainly is. Every edit —
 * and every flush when the app is backgrounded — pushes the reminder out again.
 *
 * Pure, so it is unit-tested without a device; `native/workoutReminders.ts`
 * hands the result to iOS.
 */

/** Hours of silence before each nudge. A second, later one catches a missed first. */
export const UNSAVED_REMINDER_HOURS = [2, 12] as const;

/** Never queue more than this many; iOS keeps only 64 pending in total. */
export const MAX_UNSAVED_REMINDERS = 6;

export interface UnsavedReminder {
  /** Stable within one plan, so the queue can be rebuilt idempotently. */
  key: string;
  at: Date;
  title: string;
  body: string;
  /** Hash route opened when the notification is tapped. */
  url: string;
}

export function countCompletedSets(draft: Pick<WorkoutDraft, 'drafts'>): number {
  return draft.drafts.reduce((n, ex) => n + ex.sets.filter((s) => s.completed).length, 0);
}

export function planUnsavedWorkoutReminders(input: {
  now: Date;
  drafts: WorkoutDraft[];
  hours?: readonly number[];
}): UnsavedReminder[] {
  const hours = input.hours ?? UNSAVED_REMINDER_HOURS;
  const now = input.now.getTime();
  const out: UnsavedReminder[] = [];

  for (const d of input.drafts) {
    const done = countCompletedSets(d);
    // A draft with nothing ticked off has nothing to lose.
    if (done === 0) continue;
    for (const h of hours) {
      const at = d.updatedAt + h * 3_600_000;
      if (at <= now) continue;
      out.push({
        key: `${d.workoutId}:${h}`,
        at: new Date(at),
        title: `האימון "${d.workoutName}" עדיין פתוח`,
        body: `${done} ${done === 1 ? 'סט' : 'סטים'} עוד לא נשמרו. הקש כדי לשמור את האימון.`,
        // The dashboard shows the open draft with a one-tap "save now".
        url: '/',
      });
    }
  }

  out.sort((a, b) => a.at.getTime() - b.at.getTime());
  return out.slice(0, MAX_UNSAVED_REMINDERS);
}

/**
 * Whether the dashboard should treat an open draft as "probably forgotten" and
 * offer the one-tap save, even though it is dated today.
 */
export function isDraftStale(
  draft: Pick<WorkoutDraft, 'drafts' | 'updatedAt'>,
  now: number,
  hours: number = UNSAVED_REMINDER_HOURS[0],
): boolean {
  return countCompletedSets(draft) > 0 && now - draft.updatedAt >= hours * 3_600_000;
}

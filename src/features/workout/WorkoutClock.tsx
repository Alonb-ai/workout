import { useTick } from '@/hooks/useTick';
import type { DraftExercise } from './types';

/** "42:13" under an hour, "1:02:13" above. */
export function formatElapsed(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = h > 0 ? m.toString().padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${s.toString().padStart(2, '0')}`;
}

/**
 * Workout clock: time since the first set, and since the last one. Lives in its
 * own component so the 1 Hz tick re-renders this line only, never the six
 * exercise cards beneath it.
 *
 * The clock starts at the first ticked set rather than when the screen was
 * opened, so browsing the plan before lifting doesn't inflate it. Drafts from
 * before `completedAt` existed fall back to the draft's `startedAt`.
 */
export function WorkoutClock({
  drafts,
  getStartedAt,
}: {
  drafts: DraftExercise[];
  getStartedAt: () => number;
}) {
  const now = useTick(1000);

  let first = Infinity;
  let last = 0;
  let anyCompleted = false;
  for (const d of drafts) {
    for (const s of d.sets) {
      if (!s.completed) continue;
      anyCompleted = true;
      if (s.completedAt !== undefined) {
        first = Math.min(first, s.completedAt);
        last = Math.max(last, s.completedAt);
      }
    }
  }
  if (!anyCompleted) return null;
  const start = Number.isFinite(first) ? first : getStartedAt();

  return (
    <p className="text-2xs text-fg-muted mt-0.5">
      <span className="num">{formatElapsed((now - start) / 1000)}</span> באימון
      {last > 0 && (
        <>
          {' · '}סט אחרון לפני <span className="num">{formatElapsed((now - last) / 1000)}</span>
        </>
      )}
    </p>
  );
}

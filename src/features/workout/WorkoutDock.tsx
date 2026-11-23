import { useEffect } from 'react';
import { IconCheck } from '@/components/Icon';
import { WorkoutClock } from './WorkoutClock';
import type { DraftExercise } from './types';

/** Dock height in px, published as `--dock-h` so the page padding and the rest
 *  timer bar make room for it. Keep in sync with the dock's rendered height. */
const DOCK_H = 64;

/**
 * The workout's progress and its Finish & Save, pinned just above the tab bar.
 *
 * Both used to sit at the top of the logger — the one spot a right thumb
 * cannot reach while the phone is held one-handed between sets. Here the count
 * is always in view however far down the user has scrolled, and saving is one
 * thumb-length away instead of a scroll back to the top.
 */
export function WorkoutDock({
  completed,
  planned,
  drafts,
  getStartedAt,
  onFinish,
}: {
  completed: number;
  planned: number;
  drafts: DraftExercise[];
  getStartedAt: () => number;
  onFinish: () => void;
}) {
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--dock-h', `${DOCK_H}px`);
    return () => {
      root.style.removeProperty('--dock-h');
    };
  }, []);

  const pct = planned === 0 ? 0 : Math.min(1, completed / planned);

  return (
    <div
      className="fixed inset-x-0 z-30 pointer-events-none"
      style={{ bottom: 'calc(60px + var(--safe-bottom))' }}
    >
      <div className="max-w-2xl mx-auto px-3 pb-1.5">
        <div
          className="pointer-events-auto card overflow-hidden bg-ink-850/95 backdrop-blur shadow-raised"
          style={{ height: DOCK_H - 6 }}
          role="region"
          aria-label="התקדמות אימון"
        >
          <div className="h-full flex items-center gap-3 ps-4 pe-1.5 relative">
            <div className="flex-1 min-w-0">
              <p className="num-display text-lg leading-none">
                {completed} / {planned} <span className="text-xs font-semibold text-fg-muted">סטים</span>
              </p>
              <WorkoutClock drafts={drafts} getStartedAt={getStartedAt} />
            </div>
            <button
              className="btn-primary !min-h-11 !px-4 text-sm shrink-0"
              onClick={onFinish}
            >
              <IconCheck size={16} /> סיים ושמור
            </button>
            {/* Progress groove along the bottom edge — carved, like every rail. */}
            <div className="absolute inset-x-0 bottom-0 h-1 bg-ink-950 shadow-field">
              <div
                className="h-full rounded-e-full bg-gradient-to-l from-accent to-accent-hover transition-[width] duration-500 ease-out"
                style={{ width: `${pct * 100}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

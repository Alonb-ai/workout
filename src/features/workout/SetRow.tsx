import { useState } from 'react';
import { NumberInput } from '@/components/NumberInput';
import type { DraftSet } from './types';
import { IconCalc, IconCheck, IconDots, IconTrash, IconX } from '@/components/Icon';
import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/utils/cn';

interface Props {
  set: DraftSet;
  index: number;
  /** Planned-set number shown in the row; null marks a drop set. */
  ordinal?: number | null;
  /** Included in every control's label — six cards of "set 1" are otherwise
   *  indistinguishable to a screen reader (and to a test). */
  exerciseName: string;
  onChange: (next: DraftSet) => void;
  onComplete: () => void;
  onRemove: () => void;
  onOpenPlate: (weight: number) => void;
  canRemove: boolean;
}

export function SetRow({
  set,
  index,
  ordinal,
  exerciseName,
  onChange,
  onComplete,
  onRemove,
  onOpenPlate,
  canRemove,
}: Props) {
  const isDrop = ordinal === null;
  const suffix = isDrop
    ? `${exerciseName} · דרופ ${index + 1}`
    : `${exerciseName} · סט ${ordinal ?? index + 1}`;
  // Expand RPE row when the chip is tapped, or whenever the set already has
  // an RPE — so a previously-entered value is editable without a second tap.
  // Derived, not initialised-once local state: rows are keyed by index, so after
  // a delete React reuses the instance at that index and mount-time state leaked
  // the removed row's expansion onto its replacement. `rpeTouched` only tracks
  // the tap that opens an empty RPE field.
  const [rpeTouched, setRpeTouched] = useState(false);
  // The plate calculator, RPE and delete are reached for a few times a session,
  // not every set; they live one tap behind ⋯ so the row is just the numbers
  // and a ✓ big enough to hit without looking. An RPE that is already set keeps
  // the strip open, so the value is never hidden.
  const [toolsTouched, setToolsTouched] = useState(false);
  const reduceMotion = useReducedMotion();
  const rpeOpen = rpeTouched || (set.rpe !== undefined && set.rpe !== '');
  const typed = set.weight !== '' && set.reps !== '';
  // A set the app has already prescribed can be logged with one tap — the ghost
  // values get written in as real numbers. Only reps are required; 0 kg is a
  // legitimate bodyweight set.
  const canComplete = typed || set.reps !== '' || (set.ghostReps !== undefined && set.ghostReps > 0);
  const toolsOpen = toolsTouched || rpeOpen;
  const rpeLabel = set.rpe === undefined || set.rpe === '' ? 'RPE' : `R${set.rpe}`;

  return (
    <div
      className={cn(
        'rounded-xl border transition-colors duration-150',
        set.completed ? 'bg-good-soft/25 border-good/25' : 'border-transparent',
        isDrop && 'ms-4',
      )}
    >
      <div className="flex items-center gap-1.5 py-1.5 px-1.5">
        <span
          className={cn(
            'num w-5 text-center text-2xs font-bold shrink-0 tabular-nums',
            set.completed ? 'text-good' : 'text-fg-dim',
          )}
        >
          {isDrop ? '↓' : (ordinal ?? index + 1)}
        </span>

        <div className="flex-1 min-w-0 grid grid-cols-2 gap-1.5">
          <NumberInput
            value={set.weight}
            onChange={(v) => onChange({ ...set, weight: v })}
            ghost={set.ghostWeight !== undefined && set.ghostWeight > 0 ? set.ghostWeight : undefined}
            ariaLabel={`משקל · ${suffix}`}
            step={2.5}
            decimals={2}
            min={0}
            inputClassName="!px-1.5"
          />
          <NumberInput
            value={set.reps}
            onChange={(v) => onChange({ ...set, reps: v })}
            ghost={set.ghostReps}
            ariaLabel={`חזרות · ${suffix}`}
            step={1}
            decimals={0}
            min={0}
            inputClassName="!px-1.5"
          />
        </div>

        {/* ✓ sits immediately after the two inputs — it is the one control the
            user reaches for every single set, so it gets the shortest thumb
            path and the most weight. The rarely-used trio sits behind ⋯. */}
        {/* Three states, no in-between mud. Done: solid green. Typed and ready:
            solid accent. Prescribed but untouched: OUTLINED accent — an invitation,
            not a half-lit version of the real button. `bg-accent/40` over the dark
            surface composited to brown and read as disabled. */}
        <motion.button
          type="button"
          whileTap={reduceMotion ? undefined : { scale: 0.88 }}
          transition={{ type: 'spring', stiffness: 600, damping: 30 }}
          className={cn(
            'btn-icon !min-w-12 !min-h-12 shrink-0 rounded-xl',
            set.completed
              ? 'bg-good text-ink-950 hover:bg-good shadow-soft'
              : typed
                ? 'bg-accent text-ink-950 hover:bg-accent-hover shadow-accent-lift'
                : canComplete
                  ? 'border border-accent/60 text-accent-text hover:bg-accent-soft'
                  : 'field text-fg-ghost',
          )}
          aria-label={
            set.completed
              ? `בטל סימון · ${suffix}`
              : !typed && canComplete
                ? `סמן לפי היעד · ${suffix}`
                : `סמן · ${suffix}`
          }
          onClick={onComplete}
          disabled={!canComplete && !set.completed}
        >
          <IconCheck size={22} />
        </motion.button>

        <button
          type="button"
          className={cn(
            'btn-icon !min-w-9 !min-h-11 shrink-0 text-fg-dim hover:text-fg',
            toolsOpen && 'text-fg',
          )}
          aria-label={`עוד · ${suffix}`}
          aria-expanded={toolsOpen}
          onClick={() => setToolsTouched((v) => !v)}
        >
          <IconDots size={18} />
        </button>
      </div>

      {toolsOpen && (
        <div className="flex items-center justify-end gap-1.5 px-1.5 pb-1.5">
          <button
            type="button"
            className="btn-ghost !min-h-11 !px-3 text-xs text-fg-muted hover:text-info"
            aria-label={`חישוב פלטות · ${suffix}`}
            onClick={() => {
              const w = set.weight === '' ? (set.ghostWeight ?? 0) : Number(set.weight);
              onOpenPlate(w);
            }}
          >
            <IconCalc size={16} /> פלטות
          </button>

          <button
            type="button"
            className={cn(
              'shrink-0 num text-xs font-bold rounded-xl px-3 h-11 min-w-11 transition-colors',
              rpeOpen
                ? 'bg-info-soft text-info'
                : set.rpe !== undefined && set.rpe !== ''
                  ? 'bg-info-soft/50 text-info'
                  : 'field text-fg-dim',
            )}
            aria-label={`ערוך RPE · ${suffix}`}
            onClick={() => {
              if (rpeOpen) {
                setRpeTouched(false);
                onChange({ ...set, rpe: '' });
              } else {
                setRpeTouched(true);
              }
            }}
          >
            {rpeLabel}
          </button>

          {canRemove && (
            <button
              type="button"
              className="btn-ghost !min-h-11 !px-3 text-xs text-fg-ghost hover:text-bad"
              aria-label={`מחק · ${suffix}`}
              onClick={() => {
                // Rows are keyed by index: the next row reuses this instance, so
                // close the strip rather than leak it onto the row that moves up.
                setToolsTouched(false);
                onRemove();
              }}
            >
              <IconTrash size={14} /> מחק
            </button>
          )}
        </div>
      )}

      {rpeOpen && (
        <div className="flex items-center gap-2 px-2 pb-2 pt-1 border-t border-line/40">
          <div className="flex-1 min-w-0">
            <p className="text-2xs text-fg-muted mb-1">
              עצימות (1 = קל לחלוטין · 10 = כישלון)
            </p>
            <NumberInput
              value={set.rpe ?? ''}
              onChange={(v) => onChange({ ...set, rpe: v })}
              ariaLabel="RPE"
              min={1}
              max={10}
              decimals={1}
              step={0.5}
              withSteppers
              placeholder="—"
            />
          </div>
          <button
            type="button"
            className="btn-icon !min-w-9 !min-h-9 shrink-0 text-fg-muted self-end"
            aria-label={`סגור עריכת RPE · ${suffix}`}
            onClick={() => {
              setRpeTouched(false);
              onChange({ ...set, rpe: '' });
            }}
          >
            <IconX size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

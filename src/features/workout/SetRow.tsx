import { useState } from 'react';
import { NumberInput } from '@/components/NumberInput';
import type { DraftSet } from './types';
import { IconCalc, IconCheck, IconTrash, IconX } from '@/components/Icon';
import { cn } from '@/utils/cn';

interface Props {
  set: DraftSet;
  index: number;
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
  exerciseName,
  onChange,
  onComplete,
  onRemove,
  onOpenPlate,
  canRemove,
}: Props) {
  const suffix = `${exerciseName} · סט ${index + 1}`;
  // Expand RPE row when the chip is tapped, or whenever the set already has
  // an RPE — so a previously-entered value is editable without a second tap.
  // Derived, not initialised-once local state: rows are keyed by index, so after
  // a delete React reuses the instance at that index and mount-time state leaked
  // the removed row's expansion onto its replacement. `rpeTouched` only tracks
  // the tap that opens an empty RPE field.
  const [rpeTouched, setRpeTouched] = useState(false);
  const rpeOpen = rpeTouched || (set.rpe !== undefined && set.rpe !== '');
  const typed = set.weight !== '' && set.reps !== '';
  // A set the app has already prescribed can be logged with one tap — the ghost
  // values get written in as real numbers. Only reps are required; 0 kg is a
  // legitimate bodyweight set.
  const canComplete = typed || set.reps !== '' || (set.ghostReps !== undefined && set.ghostReps > 0);
  const rpeLabel = set.rpe === undefined || set.rpe === '' ? 'RPE' : `R${set.rpe}`;

  return (
    <div
      className={cn(
        'rounded-xl border transition-colors duration-150',
        set.completed ? 'bg-good-soft/25 border-good/25' : 'border-transparent',
      )}
    >
      <div className="flex items-center gap-1.5 py-1.5 px-1.5">
        <span
          className={cn(
            'num w-5 text-center text-2xs font-bold shrink-0 tabular-nums',
            set.completed ? 'text-good' : 'text-fg-dim',
          )}
        >
          {index + 1}
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
            path and the most weight. The secondary trio follows it, dimmed. */}
        {/* Three states, no in-between mud. Done: solid green. Typed and ready:
            solid accent. Prescribed but untouched: OUTLINED accent — an invitation,
            not a half-lit version of the real button. `bg-accent/40` over the dark
            surface composited to brown and read as disabled. */}
        <button
          type="button"
          className={cn(
            'btn-icon !min-w-10 !min-h-10 shrink-0 rounded-xl',
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
          <IconCheck size={18} />
        </button>

        <button
          type="button"
          className="btn-icon !min-w-8 !min-h-9 shrink-0 text-fg-dim hover:text-info"
          aria-label={`חישוב פלטות · ${suffix}`}
          onClick={() => {
            const w = set.weight === '' ? (set.ghostWeight ?? 0) : Number(set.weight);
            onOpenPlate(w);
          }}
        >
          <IconCalc size={16} />
        </button>

        <button
          type="button"
          className={cn(
            'shrink-0 num text-2xs font-bold rounded-lg px-1.5 h-9 min-w-9 transition-colors',
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
            className="btn-icon !min-w-8 !min-h-9 shrink-0 text-fg-ghost hover:text-bad"
            aria-label={`מחק · ${suffix}`}
            onClick={onRemove}
          >
            <IconTrash size={14} />
          </button>
        )}
      </div>

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

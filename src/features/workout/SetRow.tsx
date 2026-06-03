import { useState } from 'react';
import { NumberInput } from '@/components/NumberInput';
import type { DraftSet } from './types';
import { IconCalc, IconCheck, IconTrash, IconX } from '@/components/Icon';
import { cn } from '@/utils/cn';

interface Props {
  set: DraftSet;
  index: number;
  onChange: (next: DraftSet) => void;
  onComplete: () => void;
  onRemove: () => void;
  onOpenPlate: (weight: number) => void;
  canRemove: boolean;
}

export function SetRow({
  set,
  index,
  onChange,
  onComplete,
  onRemove,
  onOpenPlate,
  canRemove,
}: Props) {
  // Expand RPE row when the chip is tapped, or whenever the set already has
  // an RPE — so a previously-entered value is editable without a second tap.
  const [rpeOpen, setRpeOpen] = useState<boolean>(set.rpe !== undefined && set.rpe !== '');
  const filled = set.weight !== '' && set.reps !== '';
  const rpeLabel = set.rpe === undefined || set.rpe === '' ? 'RPE' : `R${set.rpe}`;

  return (
    <div
      className={cn(
        'rounded-xl transition-colors',
        set.completed && 'bg-good-soft/30 border border-good/30',
      )}
    >
      <div className="flex items-center gap-1.5 py-1.5 px-1.5">
        <span
          className={cn(
            'num w-5 text-center text-xs font-bold shrink-0',
            set.completed ? 'text-good' : 'text-fg-muted',
          )}
        >
          {index + 1}
        </span>

        <div className="flex-1 min-w-0 grid grid-cols-2 gap-1.5">
          <NumberInput
            value={set.weight}
            onChange={(v) => onChange({ ...set, weight: v })}
            ghost={set.ghostWeight !== undefined && set.ghostWeight > 0 ? set.ghostWeight : undefined}
            ariaLabel={`משקל סט ${index + 1}`}
            step={2.5}
            decimals={2}
            min={0}
            inputClassName="!px-1.5"
          />
          <NumberInput
            value={set.reps}
            onChange={(v) => onChange({ ...set, reps: v })}
            ghost={set.ghostReps}
            ariaLabel={`חזרות סט ${index + 1}`}
            step={1}
            decimals={0}
            min={0}
            inputClassName="!px-1.5"
          />
        </div>

        <button
          type="button"
          className="btn-icon !min-w-8 !min-h-9 shrink-0 text-info"
          aria-label="חישוב פלטות"
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
            'btn-icon !min-w-9 !min-h-9 shrink-0 transition-colors',
            set.completed
              ? 'bg-good text-ink-950 hover:bg-good'
              : filled
                ? 'bg-accent text-ink-950 hover:bg-accent-hover'
                : 'bg-ink-700 text-fg-muted',
          )}
          aria-label={set.completed ? 'סט בוצע' : 'סמן סט'}
          onClick={onComplete}
          disabled={!filled && !set.completed}
        >
          <IconCheck size={18} />
        </button>

        <button
          type="button"
          className={cn(
            'shrink-0 num text-2xs font-bold rounded-md px-1.5 h-9 min-w-9 transition-colors',
            rpeOpen
              ? 'bg-info-soft text-info'
              : set.rpe !== undefined && set.rpe !== ''
                ? 'bg-info-soft/50 text-info'
                : 'bg-ink-700 text-fg-muted',
          )}
          aria-label="ערוך RPE"
          onClick={() => setRpeOpen((v) => !v)}
        >
          {rpeLabel}
        </button>

        {canRemove && (
          <button
            type="button"
            className="btn-icon !min-w-8 !min-h-9 shrink-0 text-bad/80"
            aria-label="מחק סט"
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
            aria-label="סגור עריכת RPE"
            onClick={() => setRpeOpen(false)}
          >
            <IconX size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

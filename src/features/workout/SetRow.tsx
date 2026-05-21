import { useState } from 'react';
import { NumberInput } from '@/components/NumberInput';
import type { DraftSet } from './types';
import { IconCalc, IconCheck, IconTrash } from '@/components/Icon';
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
  const [showRpe, setShowRpe] = useState(false);
  const filled = set.weight !== '' && set.reps !== '';

  return (
    <div
      className={cn(
        'flex items-center gap-2 py-1.5 px-2 rounded-xl transition-colors',
        set.completed && 'bg-good-soft/30 border border-good/30',
      )}
    >
      <span
        className={cn(
          'num w-7 text-center text-xs font-bold shrink-0',
          set.completed ? 'text-good' : 'text-fg-muted',
        )}
      >
        {index + 1}
      </span>

      <div className="flex-1 grid grid-cols-2 gap-2">
        <div>
          <NumberInput
            value={set.weight}
            onChange={(v) => onChange({ ...set, weight: v })}
            ghost={set.ghostWeight !== undefined && set.ghostWeight > 0 ? set.ghostWeight : undefined}
            ariaLabel={`משקל סט ${index + 1}`}
            step={2.5}
            decimals={2}
            min={0}
          />
        </div>
        <div>
          <NumberInput
            value={set.reps}
            onChange={(v) => onChange({ ...set, reps: v })}
            ghost={set.ghostReps}
            ariaLabel={`חזרות סט ${index + 1}`}
            step={1}
            decimals={0}
            min={0}
          />
        </div>
      </div>

      <button
        type="button"
        className="btn-icon !min-w-9 !min-h-9 shrink-0 text-info"
        aria-label="חישוב פלטות"
        onClick={() => {
          const w = set.weight === '' ? (set.ghostWeight ?? 0) : Number(set.weight);
          onOpenPlate(w);
        }}
      >
        <IconCalc size={18} />
      </button>

      <button
        type="button"
        className={cn(
          'btn-icon !min-w-10 !min-h-10 shrink-0 transition-colors',
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
        <IconCheck />
      </button>

      {canRemove && (
        <button
          type="button"
          className="btn-icon !min-w-9 !min-h-9 shrink-0 text-bad/80"
          aria-label="מחק סט"
          onClick={onRemove}
        >
          <IconTrash size={16} />
        </button>
      )}

      {/* Hidden by default; expand from menu later if desired */}
      {showRpe && (
        <NumberInput
          value={set.rpe ?? ''}
          onChange={(v) => onChange({ ...set, rpe: v })}
          placeholder="RPE"
          ariaLabel="RPE"
          min={1}
          max={10}
          decimals={1}
          step={0.5}
        />
      )}
      {!showRpe && (
        <button
          type="button"
          className="btn-subtle !min-w-0 !min-h-9 !px-2 text-2xs"
          onClick={() => setShowRpe(true)}
        >
          RPE
        </button>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Modal } from '@/components/Modal';
import { NumberInput } from '@/components/NumberInput';
import { IconCheck } from '@/components/Icon';
import { useSettings } from '@/hooks/useSettings';
import { computePlateLayout } from '@/utils/plateMath';
import { resolveIncrement } from '@/utils/progression';
import { warmupSets } from '@/utils/warmup';
import { cn } from '@/utils/cn';
import type { DraftExercise } from './types';

interface Props {
  open: boolean;
  onClose: () => void;
  draft: DraftExercise;
  /** Net working weight to ramp toward (prescribed or typed). */
  workWeight: number;
}

/**
 * Warm-up ramp toward today's working weight. A guide, not a log: warm-up sets
 * are deliberately NOT written to the session — they would inflate volume and
 * completion, and give the progression engine sets it would have to ignore.
 * The ticks here are only so he can keep his place between sets.
 */
export function WarmupModal({ open, onClose, draft, workWeight }: Props) {
  const settings = useSettings();
  const [weight, setWeight] = useState<number | ''>(workWeight || '');
  const [done, setDone] = useState<number[]>([]);

  // Re-seed each time it opens, so it follows the weight he is about to lift.
  useEffect(() => {
    if (open) {
      setWeight(workWeight || '');
      setDone([]);
    }
  }, [open, workWeight]);

  const increment = resolveIncrement({
    ...(draft.incrementKg !== undefined ? { incrementKg: draft.incrementKg } : {}),
    ...(draft.isMachine ? { isMachine: true } : {}),
    inventory: settings.plateInventory,
  });
  const work = weight === '' ? 0 : Number(weight);
  const barbell = !draft.isMachine && draft.barWeight > 0;
  const sets = warmupSets({
    workWeight: work,
    barWeight: draft.barWeight,
    isMachine: draft.isMachine,
    increment,
  });

  const platesFor = (net: number): string => {
    if (!barbell) return '';
    if (net === 0) return '';
    const layout = computePlateLayout({
      requestedNet: net,
      barWeight: draft.barWeight,
      inventory: settings.plateInventory,
    });
    return layout.perSide.length > 0 ? `לכל צד: ${layout.perSide.join(' + ')}` : '';
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`חימום — ${draft.exerciseName}`}
      footer={
        <button className="btn-primary" onClick={onClose}>
          סיום
        </button>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="label">משקל עבודה (נטו kg)</label>
          <NumberInput
            value={weight}
            onChange={setWeight}
            ariaLabel="משקל עבודה לחימום"
            step={2.5}
            decimals={2}
            withSteppers
          />
        </div>

        {work <= 0 ? (
          <p className="text-xs text-fg-muted">הזן משקל עבודה כדי לחשב סטים לחימום.</p>
        ) : sets.length === 0 ? (
          <p className="text-xs text-fg-muted">
            משקל קל — אין צורך בסטים לחימום. אפשר להתחיל ישר בסט העבודה.
          </p>
        ) : (
          <ul className="space-y-1.5" aria-label="סטים לחימום">
            {sets.map((s, i) => {
              const isDone = done.includes(i);
              const plates = platesFor(s.weight);
              return (
                <li
                  key={i}
                  className={cn(
                    'field flex items-center gap-2 ps-3 pe-1.5 py-1.5 rounded-xl',
                    isDone && 'opacity-60',
                  )}
                >
                  <span className="num text-2xs text-fg-dim w-12 shrink-0">חימום {i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="num-display text-base leading-tight">
                      {s.weight === 0 && barbell ? 'מוט' : `${s.weight}kg`}
                      <span className="text-fg-ghost"> × </span>
                      {s.reps}
                    </p>
                    {plates && <p className="text-2xs text-fg-dim truncate">{plates}</p>}
                  </div>
                  <button
                    type="button"
                    className={cn(
                      'btn-icon !min-w-10 !min-h-10 shrink-0 rounded-xl',
                      isDone ? 'bg-good text-ink-950' : 'border border-line text-fg-dim',
                    )}
                    aria-label={isDone ? `בטל סימון · חימום ${i + 1}` : `סמן · חימום ${i + 1}`}
                    onClick={() =>
                      setDone((cur) => (cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i]))
                    }
                  >
                    <IconCheck size={18} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <p className="text-2xs text-fg-muted">
          האחוזים מחושבים מהמשקל הכולל{barbell ? ` (כולל מוט ${draft.barWeight}kg)` : ''} ומעוגלים
          כלפי מטה. סטי החימום לא נשמרים באימון ולא נספרים בנפח.
        </p>
      </div>
    </Modal>
  );
}

import { ALL_MUSCLES, MUSCLE_LABEL, inferMuscles } from '@/utils/exerciseCatalog';
import type { MuscleTag } from '@/types';
import { cn } from '@/utils/cn';

/**
 * Which muscles an exercise trains — drives "similar exercise" suggestions.
 * Shows the name-based guess until the user taps a chip; from then on their
 * selection is stored as an override. "איפוס" goes back to the guess.
 */
export function MuscleChips({
  exercise,
  onChange,
}: {
  exercise: { name: string; muscles?: MuscleTag[] };
  onChange: (muscles: MuscleTag[] | undefined) => void;
}) {
  const overridden = !!exercise.muscles && exercise.muscles.length > 0;
  const active = inferMuscles({ name: exercise.name, ...(overridden ? { muscles: exercise.muscles } : {}) });

  const toggle = (m: MuscleTag) => {
    const next = active.includes(m) ? active.filter((x) => x !== m) : [...active, m];
    onChange(next.length > 0 ? next : undefined);
  };

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label className="label">שרירים עיקריים</label>
        {overridden && (
          <button
            type="button"
            className="text-2xs text-fg-dim hover:text-fg"
            onClick={() => onChange(undefined)}
          >
            איפוס לזיהוי אוטומטי
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {ALL_MUSCLES.map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={active.includes(m)}
            onClick={() => toggle(m)}
            className={cn(
              'chip min-h-9 px-2.5',
              active.includes(m)
                ? 'border-accent/40 bg-accent/[0.08] text-accent-text'
                : 'border-line text-fg-dim',
            )}
          >
            {MUSCLE_LABEL[m]}
          </button>
        ))}
      </div>
      <p className="mt-1 text-2xs text-fg-dim">
        {overridden ? 'נבחר ידנית.' : 'זוהה אוטומטית מהשם — הקישו לתיקון.'} משמש להצעת תרגילים דומים.
      </p>
    </div>
  );
}

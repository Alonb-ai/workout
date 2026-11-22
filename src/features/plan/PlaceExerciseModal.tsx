import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import { placeExercise } from '@/db/exerciseLibrary';
import { Modal } from '@/components/Modal';
import { toast } from '@/store/toast';
import type { Exercise, MuscleGroup, Workout } from '@/types';

/**
 * Pick a workout + muscle group for an exercise: moving a live exercise to
 * another workout, or putting an archived one back into the plan. The
 * exercise keeps its id, so its whole history goes with it.
 */
export function PlaceExerciseModal({
  exercise,
  open,
  onClose,
  planId,
}: {
  exercise: Exercise;
  open: boolean;
  onClose: () => void;
  /** Required for an archived exercise whose old group no longer exists. */
  planId?: string | null;
}) {
  const restoring = exercise.archivedAt !== undefined;
  const targets = useLiveQuery(async () => {
    if (!open) return [];
    let pid = planId ?? null;
    if (!pid) {
      const group = await db.muscleGroups.get(exercise.muscleGroupId);
      const workout = group ? await db.workouts.get(group.workoutId) : undefined;
      pid = workout?.planId ?? null;
    }
    if (!pid) return [];
    const ws = await db.workouts.where('planId').equals(pid).sortBy('order');
    const out: { workout: Workout; groups: MuscleGroup[] }[] = [];
    for (const w of ws) {
      const gs = await db.muscleGroups.where('workoutId').equals(w.id).sortBy('order');
      out.push({ workout: w, groups: gs });
    }
    return out;
  }, [open, exercise.muscleGroupId, planId]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={restoring ? `החזרת "${exercise.name}" לתכנית` : `העברת "${exercise.name}"`}
    >
      <p className="mb-3 text-2xs text-fg-dim">
        {restoring
          ? 'בחרו לאן להחזיר אותו. ההיסטוריה וההתקדמות שלו ממשיכות מאיפה שעצרו.'
          : 'ההיסטוריה וההתקדמות של התרגיל עוברות איתו.'}
      </p>
      <div className="space-y-3 max-h-[60vh] overflow-y-auto">
        {targets !== undefined && targets.length === 0 && (
          <p className="text-center text-sm text-fg-muted py-6">אין אימונים בתכנית.</p>
        )}
        {(targets ?? []).map(({ workout, groups }) => (
          <div key={workout.id}>
            <p className="eyebrow mb-1 px-1">
              <span className="num">{workout.code}</span> · {workout.name}
            </p>
            {groups.length === 0 ? (
              <p className="px-1 text-2xs text-fg-ghost">אין קבוצות שריר באימון הזה</p>
            ) : (
              <ul className="card-flat divide-y divide-line-muted">
                {groups.map((g) => {
                  const here = !restoring && g.id === exercise.muscleGroupId;
                  return (
                    <li key={g.id}>
                      <button
                        disabled={here}
                        className="w-full min-h-11 px-3 text-right text-sm hover:bg-ink-800 disabled:text-fg-ghost"
                        onClick={async () => {
                          await placeExercise(exercise.id, g.id);
                          onClose();
                          toast.success(
                            `${restoring ? 'הוחזר' : 'הועבר'} ל${workout.name.split('—')[0]?.trim()} · ${g.name}`,
                          );
                        }}
                      >
                        {g.name}
                        {here && ' · כאן עכשיו'}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}

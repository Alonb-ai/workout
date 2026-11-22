import { useEffect, useState } from 'react';
import { Modal } from '@/components/Modal';
import { db } from '@/db/db';
import { createExercise, isLive, swapInPlan } from '@/db/exerciseLibrary';
import { MUSCLE_LABEL } from '@/utils/exerciseCatalog';
import { buildDraftForExercise } from './buildSession';
import { ExercisePicker, groupForRow, usePickRows, type PickChoice } from './ExercisePicker';
import type { DraftExercise } from './types';
import type { Exercise, MuscleGroup } from '@/types';
import { toast } from '@/store/toast';

type Scope = 'session' | 'plan';

/**
 * Swap one exercise of the running session for another.
 *
 * "רק לאימון הזה" touches nothing but the session. "גם בתכנית" puts the new
 * exercise in the old one's slot in the plan and archives the old one — its
 * history stays, in the exercise library. Either way both exercises keep
 * their own, separate histories.
 */
export function SwapExerciseModal({
  open,
  onClose,
  workoutId,
  target,
  existingDraftExerciseIds,
  onSwap,
}: {
  open: boolean;
  onClose: () => void;
  workoutId: string;
  target: DraftExercise | null;
  existingDraftExerciseIds: Set<string>;
  onSwap: (incoming: DraftExercise, scope: Scope) => void;
}) {
  const rows = usePickRows(open, workoutId);
  const [scope, setScope] = useState<Scope>('session');
  const [targetRow, setTargetRow] = useState<Exercise | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !target) return;
    setScope('session');
    let cancelled = false;
    void db.exercises.get(target.exerciseId).then((ex) => {
      if (!cancelled) setTargetRow(ex ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [open, target]);

  // A permanent swap only makes sense for an exercise that is in this
  // workout's lineup — not one borrowed for today or already archived.
  const canPersist =
    !!targetRow && isLive(targetRow) && targetRow.muscleGroupId === target?.muscleGroupId;

  const pick = async (choice: PickChoice) => {
    if (!target || busy) return;
    setBusy(true);
    try {
      const persist = scope === 'plan' && canPersist;
      let exercise: Exercise;
      let group: MuscleGroup;
      if (choice.kind === 'existing') {
        exercise = choice.row.exercise;
        group = groupForRow(choice.row);
      } else {
        const c = choice.entry;
        exercise = await createExercise(
          {
            muscleGroupId: target.muscleGroupId,
            name: c.name,
            // Same volume and rest as the lift it replaces; the rep range is
            // the new exercise's own.
            targetSets: target.targetSets,
            targetRepsMin: c.repsMin,
            targetRepsMax: c.repsMax,
            defaultRestSec: target.defaultRestSec,
            barWeight: 0,
            isMachine: !!c.isMachine,
            muscles: c.muscles,
          },
          { oneOff: true, groupName: target.muscleGroupName || MUSCLE_LABEL[c.muscles[0]!] },
        );
        group = (await db.muscleGroups.get(target.muscleGroupId)) ?? {
          id: target.muscleGroupId,
          workoutId,
          name: target.muscleGroupName,
          order: 0,
        };
      }

      if (persist) {
        await swapInPlan(target.exerciseId, exercise.id);
        exercise = (await db.exercises.get(exercise.id)) ?? exercise;
        group = (await db.muscleGroups.get(exercise.muscleGroupId)) ?? group;
      }

      const draft = await buildDraftForExercise(exercise, group);
      onSwap(draft, persist ? 'plan' : 'session');
      onClose();
      toast.success(
        persist
          ? `${exercise.name} נכנס לתכנית במקום ${target.exerciseName}. ההיסטוריה של שניהם נשמרת.`
          : `הוחלף לאימון הזה: ${exercise.name}`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="החלפת תרגיל" size="lg">
      {target && (
        <>
          <p className="mb-2 text-xs text-fg-muted">
            במקום <span className="font-semibold text-fg">{target.exerciseName}</span>
          </p>
          <div className="seg flex w-full mb-2">
            <button
              data-active={scope === 'session'}
              className="pill-tab flex-1 flex items-center justify-center min-h-11"
              onClick={() => setScope('session')}
            >
              רק לאימון הזה
            </button>
            <button
              data-active={scope === 'plan'}
              disabled={!canPersist}
              className="pill-tab flex-1 flex items-center justify-center min-h-11 disabled:opacity-40"
              onClick={() => setScope('plan')}
            >
              גם בתכנית
            </button>
          </div>
          <p className="mb-3 text-2xs text-fg-dim leading-relaxed">
            {scope === 'plan'
              ? `התרגיל החדש ייכנס לתכנית במקומו, ו-${target.exerciseName} יעבור לספריית התרגילים עם כל ההיסטוריה שלו.`
              : 'התכנית לא משתנה. באימון הבא יחזור התרגיל המקורי.'}
          </p>
          <ExercisePicker
            rows={rows}
            excludeIds={existingDraftExerciseIds}
            reference={{
              name: target.exerciseName,
              groupName: target.muscleGroupName,
              ...(targetRow?.muscles ? { muscles: targetRow.muscles } : {}),
              ...(target.isMachine ? { isMachine: true } : {}),
            }}
            onPick={(c) => void pick(c)}
          />
        </>
      )}
    </Modal>
  );
}

import { useEffect, useState } from 'react';
import { Modal } from '@/components/Modal';
import { NumberInput } from '@/components/NumberInput';
import { IconCheck } from '@/components/Icon';
import { db } from '@/db/db';
import { createExercise } from '@/db/exerciseLibrary';
import { MUSCLE_LABEL } from '@/utils/exerciseCatalog';
import { buildDraftForExercise } from './buildSession';
import { ExercisePicker, groupForRow, usePickRows, type PickChoice } from './ExercisePicker';
import type { DraftExercise } from './types';
import type { MuscleGroup } from '@/types';
import { toast } from '@/store/toast';

interface Props {
  open: boolean;
  onClose: () => void;
  workoutId: string;
  /** Exercise IDs already in the current draft — filtered out from the pick-list. */
  existingDraftExerciseIds: Set<string>;
  onAdd: (draft: DraftExercise) => void;
}

type Mode = 'pick' | 'create';

/**
 * Adding an exercise to a running session is a session-only act by default:
 * picking from the plan or the library never changes the plan, and a newly
 * invented exercise is filed in the library (archived) unless the user ticks
 * "add to the plan". Either way it is a real exercise row, so its history and
 * progression carry over the next time it is picked.
 */
export function AddExerciseModal({
  open,
  onClose,
  workoutId,
  existingDraftExerciseIds,
  onAdd,
}: Props) {
  const [mode, setMode] = useState<Mode>('pick');
  const rows = usePickRows(open, workoutId);
  const [workoutGroups, setWorkoutGroups] = useState<MuscleGroup[]>([]);
  const [workoutName, setWorkoutName] = useState('');

  // Create-new form state
  const [newName, setNewName] = useState('');
  const [newGroupId, setNewGroupId] = useState<string>('');
  const [newSets, setNewSets] = useState<number>(3);
  const [newRepsMin, setNewRepsMin] = useState<number>(6);
  const [newRepsMax, setNewRepsMax] = useState<number>(10);
  const [newRest, setNewRest] = useState<number>(120);
  const [newIsMachine, setNewIsMachine] = useState(false);
  const [addToPlan, setAddToPlan] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const workout = await db.workouts.get(workoutId);
      const groups = (await db.muscleGroups.where('workoutId').equals(workoutId).toArray()).sort(
        (a, b) => a.order - b.order,
      );
      if (cancelled) return;
      setWorkoutName(workout?.name ?? '');
      setWorkoutGroups(groups);
      if (!newGroupId && groups[0]) setNewGroupId(groups[0].id);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, workoutId, newGroupId]);

  // Reset on close
  useEffect(() => {
    if (open) return;
    setMode('pick');
    setNewName('');
    setNewIsMachine(false);
    setAddToPlan(false);
  }, [open]);

  const pick = async (choice: PickChoice) => {
    if (choice.kind === 'existing') {
      const draft = await buildDraftForExercise(choice.row.exercise, groupForRow(choice.row));
      onAdd(draft);
      onClose();
      toast.success(`נוסף: ${choice.row.exercise.name}`);
      return;
    }
    // A catalog idea becomes a library exercise used in this session only.
    const c = choice.entry;
    const groupName = MUSCLE_LABEL[c.muscles[0]!];
    const exercise = await createExercise(
      {
        muscleGroupId: '',
        name: c.name,
        targetSets: 3,
        targetRepsMin: c.repsMin,
        targetRepsMax: c.repsMax,
        defaultRestSec: 120,
        barWeight: 0,
        isMachine: !!c.isMachine,
        muscles: c.muscles,
      },
      { oneOff: true, workoutName, groupName },
    );
    const draft = await buildDraftForExercise(exercise, {
      id: '',
      workoutId,
      name: groupName,
      order: 0,
    });
    onAdd(draft);
    onClose();
    toast.success(`נוסף לאימון הזה: ${c.name}`);
  };

  const createNew = async () => {
    const name = newName.trim();
    if (!name) {
      toast.error('יש להזין שם תרגיל');
      return;
    }
    if (newRepsMin > newRepsMax) {
      toast.error('טווח חזרות לא תקין');
      return;
    }
    const group = workoutGroups.find((g) => g.id === newGroupId) ?? workoutGroups[0];
    if (!group) {
      toast.error('אין קבוצות שריר באימון — צרו קודם באמצעות עורך התכנית');
      return;
    }
    const exercise = await createExercise(
      {
        muscleGroupId: group.id,
        name,
        targetSets: Math.max(1, newSets),
        targetRepsMin: Math.max(1, newRepsMin),
        targetRepsMax: Math.max(newRepsMin, newRepsMax),
        defaultRestSec: Math.max(15, newRest),
        barWeight: 0,
        isMachine: newIsMachine,
      },
      { oneOff: !addToPlan },
    );
    const draft = await buildDraftForExercise(exercise, group);
    onAdd(draft);
    onClose();
    toast.success(addToPlan ? 'נוסף לתכנית ולאימון' : 'נוסף לאימון הזה');
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="הוסף תרגיל לאימון"
      size="lg"
      footer={
        mode === 'create' ? (
          <>
            <button className="btn-ghost" onClick={onClose}>
              ביטול
            </button>
            <button className="btn-primary" onClick={createNew}>
              <IconCheck size={16} /> הוסף
            </button>
          </>
        ) : (
          <button className="btn-ghost" onClick={onClose}>
            סגור
          </button>
        )
      }
    >
      {/* One recessed track with the active pill riding on it — the two modes
          read as one control instead of two loose buttons. */}
      <div className="seg flex w-full mb-3">
        <button
          data-active={mode === 'pick'}
          className="pill-tab flex-1 flex items-center justify-center min-h-11"
          onClick={() => setMode('pick')}
        >
          מהרשימה
        </button>
        <button
          data-active={mode === 'create'}
          className="pill-tab flex-1 flex items-center justify-center min-h-11"
          onClick={() => setMode('create')}
        >
          תרגיל חדש
        </button>
      </div>

      {mode === 'pick' ? (
        <ExercisePicker rows={rows} excludeIds={existingDraftExerciseIds} onPick={pick} />
      ) : (
        <div className="space-y-3">
          <div>
            <label className="label">שם התרגיל</label>
            <input
              className="input !min-h-12 text-base"
              autoFocus
              placeholder="לדוגמה: Cable Crossover"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>

          <div>
            <label className="label">קבוצת שריר</label>
            {workoutGroups.length === 0 ? (
              <p className="text-2xs text-fg-muted">אין קבוצות שריר באימון הנוכחי.</p>
            ) : (
              <select
                className="input"
                value={newGroupId}
                onChange={(e) => setNewGroupId(e.target.value)}
              >
                {workoutGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">סטים</label>
              <NumberInput
                value={newSets}
                onChange={(v) => setNewSets(v === '' ? 1 : Math.max(1, Number(v)))}
                min={1}
                step={1}
                decimals={0}
                withSteppers
              />
            </div>
            <div>
              <label className="label">מנוחה (שניות)</label>
              <NumberInput
                value={newRest}
                onChange={(v) => setNewRest(v === '' ? 60 : Math.max(15, Number(v)))}
                min={15}
                step={15}
                decimals={0}
                withSteppers
              />
            </div>
            <div>
              <label className="label">חזרות מינ׳</label>
              <NumberInput
                value={newRepsMin}
                onChange={(v) => setNewRepsMin(v === '' ? 1 : Math.max(1, Number(v)))}
                min={1}
                step={1}
                decimals={0}
                withSteppers
              />
            </div>
            <div>
              <label className="label">חזרות מקס׳</label>
              <NumberInput
                value={newRepsMax}
                onChange={(v) => setNewRepsMax(v === '' ? 1 : Math.max(1, Number(v)))}
                min={1}
                step={1}
                decimals={0}
                withSteppers
              />
            </div>
          </div>

          <label className="flex items-center gap-3 text-sm card-flat px-3 min-h-[52px] cursor-pointer">
            <input
              type="checkbox"
              className="w-5 h-5 accent-orange-500"
              checked={newIsMachine}
              onChange={(e) => setNewIsMachine(e.target.checked)}
            />
            מכונה / סטאק
          </label>

          <label className="flex items-center gap-3 text-sm card-flat px-3 min-h-[52px] cursor-pointer">
            <input
              type="checkbox"
              className="w-5 h-5 accent-orange-500"
              checked={addToPlan}
              onChange={(e) => setAddToPlan(e.target.checked)}
            />
            להוסיף גם לתכנית (יופיע בכל אימון הבא)
          </label>

          <p className="relative ps-3 text-2xs text-fg-dim leading-relaxed">
            <span className="absolute inset-y-0 start-0 w-[3px] rounded-full bg-line" aria-hidden />
            {addToPlan
              ? 'התרגיל ייכנס לתכנית של האימון הזה.'
              : 'התרגיל יתווסף לאימון הזה בלבד ויישמר בספריית התרגילים — ההיסטוריה שלו נשמרת ואפשר לבחור אותו שוב בכל אימון.'}
          </p>
        </div>
      )}
    </Modal>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/components/Modal';
import { NumberInput } from '@/components/NumberInput';
import {
  IconBarbell,
  IconCheck,
  IconPlus,
  IconSearch,
} from '@/components/Icon';
import { db, newId, now } from '@/db/db';
import { buildDraftForExercise } from './buildSession';
import type { DraftExercise } from './types';
import type { Exercise, MuscleGroup } from '@/types';
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

export function AddExerciseModal({
  open,
  onClose,
  workoutId,
  existingDraftExerciseIds,
  onAdd,
}: Props) {
  const [mode, setMode] = useState<Mode>('pick');
  const [search, setSearch] = useState('');
  const [planExercises, setPlanExercises] = useState<
    { exercise: Exercise; group: MuscleGroup; workoutName: string; isInCurrentWorkout: boolean }[]
  >([]);
  const [workoutGroups, setWorkoutGroups] = useState<MuscleGroup[]>([]);

  // Create-new form state
  const [newName, setNewName] = useState('');
  const [newGroupId, setNewGroupId] = useState<string>('');
  const [newSets, setNewSets] = useState<number>(3);
  const [newRepsMin, setNewRepsMin] = useState<number>(6);
  const [newRepsMax, setNewRepsMax] = useState<number>(10);
  const [newRest, setNewRest] = useState<number>(120);
  const [newIsMachine, setNewIsMachine] = useState(false);
  const [persistNew, setPersistNew] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const workout = await db.workouts.get(workoutId);
      if (!workout) return;
      // All exercises in the active plan (anywhere), so the user can grab a
      // lift from a sibling workout if they want.
      const planWorkouts = await db.workouts
        .where('planId')
        .equals(workout.planId)
        .sortBy('order');
      const planWorkoutIds = planWorkouts.map((w) => w.id);
      const allGroups = await db.muscleGroups
        .where('workoutId')
        .anyOf(planWorkoutIds)
        .toArray();
      const allExercises = await db.exercises
        .where('muscleGroupId')
        .anyOf(allGroups.map((g) => g.id))
        .toArray();

      const groupById = new Map(allGroups.map((g) => [g.id, g]));
      const workoutById = new Map(planWorkouts.map((w) => [w.id, w]));

      const rows = allExercises
        .map((e) => {
          const g = groupById.get(e.muscleGroupId);
          if (!g) return null;
          const w = workoutById.get(g.workoutId);
          return {
            exercise: e,
            group: g,
            workoutName: w?.name ?? '',
            isInCurrentWorkout: g.workoutId === workoutId,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null)
        .sort((a, b) => {
          // Current workout first, then by muscle group order, then by exercise order.
          if (a.isInCurrentWorkout !== b.isInCurrentWorkout) {
            return a.isInCurrentWorkout ? -1 : 1;
          }
          if (a.group.order !== b.group.order) return a.group.order - b.group.order;
          return a.exercise.order - b.exercise.order;
        });

      if (cancelled) return;
      setPlanExercises(rows);

      const currentGroups = allGroups
        .filter((g) => g.workoutId === workoutId)
        .sort((a, b) => a.order - b.order);
      setWorkoutGroups(currentGroups);
      if (!newGroupId && currentGroups[0]) setNewGroupId(currentGroups[0].id);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, workoutId, newGroupId]);

  // Reset on close
  useEffect(() => {
    if (open) return;
    setMode('pick');
    setSearch('');
    setNewName('');
    setPersistNew(false);
    setNewIsMachine(false);
  }, [open]);

  const filteredPick = useMemo(() => {
    const q = search.trim().toLowerCase();
    return planExercises
      .filter((r) => !existingDraftExerciseIds.has(r.exercise.id))
      .filter((r) =>
        q === ''
          ? true
          : r.exercise.name.toLowerCase().includes(q) ||
            r.group.name.toLowerCase().includes(q),
      );
  }, [planExercises, search, existingDraftExerciseIds]);

  const pickExisting = async (exerciseId: string) => {
    const row = planExercises.find((r) => r.exercise.id === exerciseId);
    if (!row) return;
    const draft = await buildDraftForExercise(row.exercise, row.group);
    onAdd(draft);
    onClose();
    toast.success(`נוסף: ${row.exercise.name}`);
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
    const t = now();
    // Place the exercise at the end of the chosen group so the plan order stays clean.
    const existingInGroup = await db.exercises
      .where('muscleGroupId')
      .equals(group.id)
      .count();
    const exercise: Exercise = {
      id: newId(),
      muscleGroupId: group.id,
      name,
      targetSets: Math.max(1, newSets),
      targetRepsMin: Math.max(1, newRepsMin),
      targetRepsMax: Math.max(newRepsMin, newRepsMax),
      defaultRestSec: Math.max(15, newRest),
      barWeight: 0,
      isMachine: newIsMachine,
      order: existingInGroup,
      createdAt: t,
      updatedAt: t,
    };
    if (persistNew) {
      // Save to the plan permanently.
      await db.exercises.add(exercise);
    } else {
      // One-time: still need the row in DB so the snapshot/history pipeline
      // works, but we mark it so the plan editor can identify it as ephemeral.
      // We achieve this with a note prefix and leaving order high; the user can
      // clean these up later from the plan editor if they want.
      exercise.notes = '[נוסף באימון בודד]';
      await db.exercises.add(exercise);
    }
    const draft = await buildDraftForExercise(exercise, group);
    onAdd(draft);
    onClose();
    toast.success(persistNew ? 'נוסף לתכנית ולאימון' : 'נוסף לאימון הנוכחי');
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
      <div className="flex gap-2 mb-3">
        <button
          data-active={mode === 'pick'}
          className="pill-tab flex-1"
          onClick={() => setMode('pick')}
        >
          מהתכנית
        </button>
        <button
          data-active={mode === 'create'}
          className="pill-tab flex-1"
          onClick={() => setMode('create')}
        >
          תרגיל חדש
        </button>
      </div>

      {mode === 'pick' ? (
        <>
          <div className="relative mb-3">
            <IconSearch
              size={16}
              className="absolute top-1/2 -translate-y-1/2 right-3 text-fg-muted pointer-events-none"
            />
            <input
              className="input pr-9 text-sm"
              placeholder="חיפוש לפי שם או קבוצת שריר…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {filteredPick.length === 0 ? (
            <p className="text-center text-sm text-fg-muted py-6">
              {planExercises.length === 0
                ? 'אין תרגילים בתכנית. צרו קודם בעורך התכנית.'
                : 'כל התרגילים מהתכנית כבר באימון. נסו "תרגיל חדש".'}
            </p>
          ) : (
            <ul className="space-y-1 max-h-[55vh] overflow-y-auto -mx-1 px-1">
              {filteredPick.map((row) => (
                <li key={row.exercise.id}>
                  <button
                    className="w-full text-right card-flat p-2.5 hover:bg-ink-800 transition-colors flex items-center gap-2"
                    onClick={() => pickExisting(row.exercise.id)}
                  >
                    <span className="w-8 h-8 rounded-lg bg-accent-soft text-accent flex items-center justify-center shrink-0">
                      <IconBarbell size={16} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{row.exercise.name}</p>
                      <p className="text-2xs text-fg-muted truncate">
                        {row.group.name}
                        {!row.isInCurrentWorkout && row.workoutName
                          ? ` · מאימון: ${row.workoutName.split('—')[0]?.trim()}`
                          : ''}
                        {' · '}
                        {row.exercise.targetSets}×{row.exercise.targetRepsMin}-{row.exercise.targetRepsMax}
                      </p>
                    </div>
                    <IconPlus size={18} className="text-accent shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="label">שם התרגיל</label>
            <input
              className="input"
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

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="w-5 h-5 accent-orange-500"
              checked={newIsMachine}
              onChange={(e) => setNewIsMachine(e.target.checked)}
            />
            מכונה / סטאק
          </label>

          <label className="flex items-start gap-2 text-sm bg-ink-900 rounded-xl p-3 border border-line cursor-pointer">
            <input
              type="checkbox"
              className="w-5 h-5 accent-orange-500 mt-0.5 shrink-0"
              checked={persistNew}
              onChange={(e) => setPersistNew(e.target.checked)}
            />
            <span>
              <span className="font-semibold">שמור גם לתכנית</span>
              <span className="block text-2xs text-fg-muted mt-0.5">
                אם לא תסמן, התרגיל ייווסף רק לאימון הנוכחי וההיסטוריה שלו תישאר. תוכל למחוק
                אותו מאוחר יותר מעורך התכנית.
              </span>
            </span>
          </label>
        </div>
      )}
    </Modal>
  );
}

import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db, newId, now } from '@/db/db';
import {
  IconBarbell,
  IconChevronDown,
  IconCopy,
  IconEdit,
  IconGrip,
  IconList,
  IconPlus,
  IconTrash,
} from '@/components/Icon';
import { Section } from '@/components/Section';
import { EmptyState } from '@/components/EmptyState';
import { Modal } from '@/components/Modal';
import { NumberInput } from '@/components/NumberInput';
import { toast } from '@/store/toast';
import { confirmDialog } from '@/components/Confirm';
import type { Plan, Workout, MuscleGroup, Exercise } from '@/types';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

export function PlanPage() {
  const plans = useLiveQuery(() => db.plans.orderBy('order').toArray(), []) ?? [];
  const activePlan = plans.find((p) => p.isActive) ?? plans[0] ?? null;
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const planId = selectedPlanId ?? activePlan?.id ?? null;

  const [editPlanOpen, setEditPlanOpen] = useState(false);
  const [editPlanDraft, setEditPlanDraft] = useState<Plan | null>(null);

  const workouts = useLiveQuery(
    async () => {
      if (!planId) return [];
      return db.workouts.where('planId').equals(planId).sortBy('order');
    },
    [planId],
  ) ?? [];

  const addPlan = async () => {
    const t = now();
    const p: Plan = {
      id: newId(),
      name: 'תכנית חדשה',
      isActive: plans.length === 0,
      order: plans.length,
      createdAt: t,
      updatedAt: t,
    };
    await db.plans.add(p);
    setSelectedPlanId(p.id);
    toast.success('תכנית נוצרה');
  };

  const duplicatePlan = async (p: Plan) => {
    const newPlanId = newId();
    const t = now();
    await db.transaction(
      'rw',
      [db.plans, db.workouts, db.muscleGroups, db.exercises],
      async () => {
        await db.plans.add({
          ...p,
          id: newPlanId,
          name: `${p.name} — עותק`,
          isActive: false,
          order: plans.length,
          createdAt: t,
          updatedAt: t,
        });
        const ws = await db.workouts.where('planId').equals(p.id).toArray();
        for (const w of ws) {
          const newWid = newId();
          await db.workouts.add({ ...w, id: newWid, planId: newPlanId, createdAt: t, updatedAt: t });
          const groups = await db.muscleGroups.where('workoutId').equals(w.id).toArray();
          for (const g of groups) {
            const newGid = newId();
            await db.muscleGroups.add({ ...g, id: newGid, workoutId: newWid });
            const exs = await db.exercises.where('muscleGroupId').equals(g.id).toArray();
            for (const e of exs) {
              await db.exercises.add({
                ...e,
                id: newId(),
                muscleGroupId: newGid,
                createdAt: t,
                updatedAt: t,
              });
            }
          }
        }
      },
    );
    toast.success('התכנית שוכפלה');
  };

  const deletePlan = async (p: Plan) => {
    const ok = await confirmDialog({
      title: `למחוק את "${p.name}"?`,
      body: 'הפעולה תמחק את התכנית ואת כל האימונים שלה. אימונים שכבר נשמרו לא יושפעו.',
      destructive: true,
      confirmLabel: 'מחק',
    });
    if (!ok) return;
    await db.transaction(
      'rw',
      [db.plans, db.workouts, db.muscleGroups, db.exercises],
      async () => {
        const ws = await db.workouts.where('planId').equals(p.id).toArray();
        for (const w of ws) {
          const gs = await db.muscleGroups.where('workoutId').equals(w.id).toArray();
          for (const g of gs) {
            await db.exercises.where('muscleGroupId').equals(g.id).delete();
          }
          await db.muscleGroups.where('workoutId').equals(w.id).delete();
        }
        await db.workouts.where('planId').equals(p.id).delete();
        await db.plans.delete(p.id);
      },
    );
    setSelectedPlanId(null);
    toast.success('תכנית נמחקה');
  };

  const setActive = async (p: Plan) => {
    await db.transaction('rw', db.plans, async () => {
      for (const plan of plans) {
        await db.plans.update(plan.id, { isActive: plan.id === p.id, updatedAt: now() });
      }
    });
    toast.success(`"${p.name}" הוגדרה כפעילה`);
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const onDragWorkouts = async (e: DragEndEvent) => {
    if (!e.over || e.over.id === e.active.id || !planId) return;
    const oldIndex = workouts.findIndex((w) => w.id === e.active.id);
    const newIndex = workouts.findIndex((w) => w.id === e.over!.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(workouts, oldIndex, newIndex);
    await db.transaction('rw', db.workouts, async () => {
      for (let i = 0; i < reordered.length; i++) {
        await db.workouts.update(reordered[i]!.id, { order: i, updatedAt: now() });
      }
    });
  };

  return (
    <div className="pt-3">
      <header className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-2xs uppercase tracking-wider text-fg-muted">תכנית אימונים</p>
          <h1 className="text-2xl font-extrabold">{activePlan?.name ?? 'תכנית'}</h1>
        </div>
        <button onClick={addPlan} className="btn-ghost !min-h-9 !px-2 text-xs">
          <IconPlus size={14} /> תכנית
        </button>
      </header>

      {plans.length > 0 && (
        <div className="flex gap-2 overflow-x-auto no-scrollbar mb-3 -mx-1 px-1 pb-1">
          {plans.map((p) => (
            <button
              key={p.id}
              data-active={p.id === planId}
              onClick={() => setSelectedPlanId(p.id)}
              className="pill-tab"
            >
              {p.name}
              {p.isActive && <span className="text-2xs ms-1 opacity-70">· פעילה</span>}
            </button>
          ))}
        </div>
      )}

      {plans.length === 0 ? (
        <EmptyState
          title="אין תכניות"
          description="הוסיפו תכנית ראשונה כדי לבנות אימונים."
          icon={<IconList />}
          action={
            <button onClick={addPlan} className="btn-primary">
              <IconPlus /> צרו תכנית
            </button>
          }
        />
      ) : (
        <>
          {activePlan && (
            <div className="card p-3 mb-4 flex items-center gap-2">
              <div className="flex-1">
                <p className="text-sm font-semibold">{activePlan.name}</p>
                {activePlan.description && (
                  <p className="text-2xs text-fg-muted">{activePlan.description}</p>
                )}
              </div>
              {!activePlan.isActive && (
                <button className="btn-ghost !min-h-9 !px-2 text-xs" onClick={() => setActive(activePlan)}>
                  הגדר כפעילה
                </button>
              )}
              <button
                className="btn-icon"
                aria-label="ערוך תכנית"
                onClick={() => {
                  setEditPlanDraft(activePlan);
                  setEditPlanOpen(true);
                }}
              >
                <IconEdit size={18} />
              </button>
              <button
                className="btn-icon"
                aria-label="שכפל"
                onClick={() => duplicatePlan(activePlan)}
              >
                <IconCopy size={18} />
              </button>
              <button
                className="btn-icon text-bad"
                aria-label="מחק"
                onClick={() => deletePlan(activePlan)}
              >
                <IconTrash size={18} />
              </button>
            </div>
          )}

          <Section
            title="אימונים"
            action={
              planId && (
                <button
                  className="btn-ghost !min-h-9 !px-2 text-xs"
                  onClick={async () => {
                    const t = now();
                    await db.workouts.add({
                      id: newId(),
                      planId,
                      name: 'אימון חדש',
                      code: `W${workouts.length + 1}`,
                      order: workouts.length,
                      defaultRestSec: 150,
                      createdAt: t,
                      updatedAt: t,
                    });
                    toast.success('אימון נוסף');
                  }}
                >
                  <IconPlus size={14} /> אימון
                </button>
              )
            }
          >
            {workouts.length === 0 ? (
              <EmptyState
                title="אין אימונים"
                description="הוסיפו אימון לתכנית."
                icon={<IconBarbell />}
              />
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragWorkouts}>
                <SortableContext items={workouts.map((w) => w.id)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-2">
                    {workouts.map((w) => (
                      <SortableWorkoutCard key={w.id} workout={w} />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </Section>
        </>
      )}

      <Modal
        open={editPlanOpen}
        onClose={() => setEditPlanOpen(false)}
        title="עריכת תכנית"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setEditPlanOpen(false)}>
              ביטול
            </button>
            <button
              className="btn-primary"
              onClick={async () => {
                if (!editPlanDraft) return;
                await db.plans.update(editPlanDraft.id, {
                  name: editPlanDraft.name,
                  ...(editPlanDraft.description ? { description: editPlanDraft.description } : { description: '' }),
                  updatedAt: now(),
                });
                setEditPlanOpen(false);
                toast.success('נשמר');
              }}
            >
              שמור
            </button>
          </>
        }
      >
        {editPlanDraft && (
          <div className="space-y-3">
            <div>
              <label className="label">שם</label>
              <input
                className="input"
                value={editPlanDraft.name}
                onChange={(e) => setEditPlanDraft({ ...editPlanDraft, name: e.target.value })}
              />
            </div>
            <div>
              <label className="label">תיאור</label>
              <textarea
                className="input min-h-20"
                value={editPlanDraft.description ?? ''}
                onChange={(e) => setEditPlanDraft({ ...editPlanDraft, description: e.target.value })}
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ============================================================================
// Sortable workout card
// ============================================================================

function SortableWorkoutCard({ workout }: { workout: Workout }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: workout.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  const [expanded, setExpanded] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [draft, setDraft] = useState(workout);

  return (
    <div ref={setNodeRef} style={style} className="card overflow-hidden">
      <div className="flex items-center gap-2 p-2.5">
        <button
          type="button"
          className="btn-icon !min-w-9 !min-h-9 text-fg-muted touch-none"
          {...attributes}
          {...listeners}
          aria-label="גרור"
        >
          <IconGrip size={18} />
        </button>
        <button
          className="flex-1 text-right flex items-center gap-1"
          onClick={() => setExpanded((v) => !v)}
        >
          <div className="flex-1 min-w-0">
            <p className="font-semibold truncate text-sm">
              <span className="num text-fg-muted me-1.5">{workout.code}</span>
              {workout.name}
            </p>
            <p className="text-2xs text-fg-muted">
              מנוחה ברירת מחדל: {Math.round(workout.defaultRestSec / 60)} דק׳
            </p>
          </div>
          <IconChevronDown
            size={18}
            className={`text-fg-muted transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        </button>
        <button
          className="btn-icon"
          aria-label="ערוך"
          onClick={() => {
            setDraft(workout);
            setEditOpen(true);
          }}
        >
          <IconEdit size={18} />
        </button>
        <button
          className="btn-icon text-bad"
          aria-label="מחק"
          onClick={async () => {
            const ok = await confirmDialog({
              title: `למחוק "${workout.name}"?`,
              body: 'יימחקו גם קבוצות השרירים והתרגילים שמתחת לאימון זה.',
              destructive: true,
              confirmLabel: 'מחק',
            });
            if (!ok) return;
            await db.transaction(
              'rw',
              [db.workouts, db.muscleGroups, db.exercises],
              async () => {
                const gs = await db.muscleGroups.where('workoutId').equals(workout.id).toArray();
                for (const g of gs) {
                  await db.exercises.where('muscleGroupId').equals(g.id).delete();
                }
                await db.muscleGroups.where('workoutId').equals(workout.id).delete();
                await db.workouts.delete(workout.id);
              },
            );
          }}
        >
          <IconTrash size={18} />
        </button>
      </div>

      {expanded && <WorkoutDetails workoutId={workout.id} />}

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="עריכת אימון"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setEditOpen(false)}>
              ביטול
            </button>
            <button
              className="btn-primary"
              onClick={async () => {
                await db.workouts.update(workout.id, {
                  name: draft.name,
                  code: draft.code,
                  defaultRestSec: draft.defaultRestSec,
                  updatedAt: now(),
                });
                setEditOpen(false);
                toast.success('נשמר');
              }}
            >
              שמור
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="label">קוד (קצר)</label>
            <input
              className="input"
              value={draft.code}
              onChange={(e) => setDraft({ ...draft, code: e.target.value })}
            />
          </div>
          <div>
            <label className="label">שם</label>
            <input
              className="input"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </div>
          <div>
            <label className="label">מנוחה ברירת מחדל (שניות)</label>
            <NumberInput
              value={draft.defaultRestSec}
              onChange={(v) => setDraft({ ...draft, defaultRestSec: v === '' ? 60 : Number(v) })}
              step={15}
              min={15}
              decimals={0}
              withSteppers
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}

function WorkoutDetails({ workoutId }: { workoutId: string }) {
  const groups = useLiveQuery(
    () => db.muscleGroups.where('workoutId').equals(workoutId).sortBy('order'),
    [workoutId],
  ) ?? [];
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const addGroup = async () => {
    await db.muscleGroups.add({
      id: newId(),
      workoutId,
      name: 'קבוצת שרירים חדשה',
      order: groups.length,
    });
  };

  const onDrag = async (e: DragEndEvent) => {
    if (!e.over || e.over.id === e.active.id) return;
    const oldIndex = groups.findIndex((g) => g.id === e.active.id);
    const newIndex = groups.findIndex((g) => g.id === e.over!.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(groups, oldIndex, newIndex);
    await db.transaction('rw', db.muscleGroups, async () => {
      for (let i = 0; i < reordered.length; i++) {
        await db.muscleGroups.update(reordered[i]!.id, { order: i });
      }
    });
  };

  return (
    <div className="border-t border-line/60 p-2 bg-ink-900/30">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDrag}>
        <SortableContext items={groups.map((g) => g.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {groups.map((g) => (
              <MuscleGroupCard key={g.id} group={g} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <button className="btn-subtle !min-h-9 text-xs mt-2" onClick={addGroup}>
        <IconPlus size={14} /> הוסף קבוצת שרירים
      </button>
    </div>
  );
}

function MuscleGroupCard({ group }: { group: MuscleGroup }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: group.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  const exercises = useLiveQuery(
    () => db.exercises.where('muscleGroupId').equals(group.id).sortBy('order'),
    [group.id],
  ) ?? [];
  const [editName, setEditName] = useState(group.name);
  const [editing, setEditing] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const addExercise = async () => {
    const t = now();
    await db.exercises.add({
      id: newId(),
      muscleGroupId: group.id,
      name: 'New Exercise',
      targetSets: 3,
      targetRepsMin: 6,
      targetRepsMax: 10,
      defaultRestSec: 120,
      barWeight: 0,
      isMachine: false,
      order: exercises.length,
      createdAt: t,
      updatedAt: t,
    });
  };

  const onDragEx = async (e: DragEndEvent) => {
    if (!e.over || e.over.id === e.active.id) return;
    const oldIndex = exercises.findIndex((x) => x.id === e.active.id);
    const newIndex = exercises.findIndex((x) => x.id === e.over!.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(exercises, oldIndex, newIndex);
    await db.transaction('rw', db.exercises, async () => {
      for (let i = 0; i < reordered.length; i++) {
        await db.exercises.update(reordered[i]!.id, { order: i, updatedAt: now() });
      }
    });
  };

  return (
    <div ref={setNodeRef} style={style} className="card-flat p-2.5 bg-ink-850">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn-icon !min-w-8 !min-h-8 text-fg-muted touch-none"
          {...attributes}
          {...listeners}
          aria-label="גרור"
        >
          <IconGrip size={16} />
        </button>
        {editing ? (
          <input
            className="input !min-h-9 !py-1 text-sm flex-1"
            value={editName}
            autoFocus
            onChange={(e) => setEditName(e.target.value)}
            onBlur={async () => {
              await db.muscleGroups.update(group.id, { name: editName.trim() || group.name });
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') {
                setEditName(group.name);
                setEditing(false);
              }
            }}
          />
        ) : (
          <button className="flex-1 text-right font-semibold text-sm" onClick={() => setEditing(true)}>
            {group.name}
          </button>
        )}
        <button
          className="btn-icon !min-w-8 !min-h-8 text-bad/80"
          aria-label="מחק"
          onClick={async () => {
            const ok = await confirmDialog({
              title: `למחוק "${group.name}"?`,
              body: 'יימחקו גם התרגילים מתחתיה.',
              destructive: true,
              confirmLabel: 'מחק',
            });
            if (!ok) return;
            await db.transaction('rw', [db.muscleGroups, db.exercises], async () => {
              await db.exercises.where('muscleGroupId').equals(group.id).delete();
              await db.muscleGroups.delete(group.id);
            });
          }}
        >
          <IconTrash size={14} />
        </button>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEx}>
        <SortableContext items={exercises.map((e) => e.id)} strategy={verticalListSortingStrategy}>
          <ul className="mt-2 space-y-1">
            {exercises.map((ex) => (
              <ExerciseRow key={ex.id} ex={ex} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      <button className="btn-subtle !min-h-8 !px-2 text-2xs mt-2" onClick={addExercise}>
        <IconPlus size={12} /> הוסף תרגיל
      </button>
    </div>
  );
}

function ExerciseRow({ ex }: { ex: Exercise }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: ex.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  const [editOpen, setEditOpen] = useState(false);
  const [draft, setDraft] = useState(ex);

  return (
    <li ref={setNodeRef} style={style} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-ink-900">
      <button
        type="button"
        className="btn-icon !min-w-7 !min-h-7 text-fg-muted touch-none"
        {...attributes}
        {...listeners}
        aria-label="גרור"
      >
        <IconGrip size={14} />
      </button>
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate">{ex.name}</p>
        <p className="text-2xs text-fg-muted num">
          {ex.targetSets}×{ex.targetRepsMin}-{ex.targetRepsMax}
          {ex.barWeight > 0 && ` · מוט ${ex.barWeight}kg`}
          {ex.isMachine && ' · מכונה'}
        </p>
      </div>
      <button
        className="btn-icon !min-w-7 !min-h-7"
        aria-label="ערוך"
        onClick={() => {
          setDraft(ex);
          setEditOpen(true);
        }}
      >
        <IconEdit size={14} />
      </button>
      <button
        className="btn-icon !min-w-7 !min-h-7 text-bad/80"
        aria-label="מחק"
        onClick={async () => {
          const ok = await confirmDialog({
            title: `למחוק את "${ex.name}"?`,
            destructive: true,
            confirmLabel: 'מחק',
          });
          if (!ok) return;
          await db.exercises.delete(ex.id);
        }}
      >
        <IconTrash size={14} />
      </button>

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="עריכת תרגיל"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setEditOpen(false)}>
              ביטול
            </button>
            <button
              className="btn-primary"
              onClick={async () => {
                await db.exercises.update(ex.id, {
                  name: draft.name.trim() || ex.name,
                  targetSets: draft.targetSets,
                  targetRepsMin: draft.targetRepsMin,
                  targetRepsMax: draft.targetRepsMax,
                  defaultRestSec: draft.defaultRestSec,
                  barWeight: draft.barWeight,
                  isMachine: draft.isMachine ?? false,
                  ...(draft.notes ? { notes: draft.notes } : { notes: '' }),
                  updatedAt: now(),
                });
                setEditOpen(false);
                toast.success('נשמר');
              }}
            >
              שמור
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="label">שם תרגיל</label>
            <input
              className="input"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">סטים</label>
              <NumberInput
                value={draft.targetSets}
                onChange={(v) =>
                  setDraft({ ...draft, targetSets: v === '' ? 1 : Math.max(1, Number(v)) })
                }
                min={1}
                step={1}
                decimals={0}
                withSteppers
              />
            </div>
            <div>
              <label className="label">מנוחה (שניות)</label>
              <NumberInput
                value={draft.defaultRestSec}
                onChange={(v) =>
                  setDraft({ ...draft, defaultRestSec: v === '' ? 60 : Math.max(15, Number(v)) })
                }
                min={15}
                step={15}
                decimals={0}
                withSteppers
              />
            </div>
            <div>
              <label className="label">חזרות מינ׳</label>
              <NumberInput
                value={draft.targetRepsMin}
                onChange={(v) =>
                  setDraft({ ...draft, targetRepsMin: v === '' ? 1 : Math.max(1, Number(v)) })
                }
                min={1}
                step={1}
                decimals={0}
                withSteppers
              />
            </div>
            <div>
              <label className="label">חזרות מקס׳</label>
              <NumberInput
                value={draft.targetRepsMax}
                onChange={(v) =>
                  setDraft({ ...draft, targetRepsMax: v === '' ? 1 : Math.max(1, Number(v)) })
                }
                min={1}
                step={1}
                decimals={0}
                withSteppers
              />
            </div>
            <div>
              <label className="label">משקל מוט (kg, לפלטות)</label>
              <NumberInput
                value={draft.barWeight}
                onChange={(v) => setDraft({ ...draft, barWeight: v === '' ? 0 : Number(v) })}
                min={0}
                step={2.5}
                decimals={2}
                withSteppers
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="w-5 h-5 accent-orange-500"
                  checked={!!draft.isMachine}
                  onChange={(e) => setDraft({ ...draft, isMachine: e.target.checked })}
                />
                מכונה/סטאק
              </label>
            </div>
          </div>
          <div>
            <label className="label">הערות</label>
            <textarea
              className="input min-h-20"
              value={draft.notes ?? ''}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            />
          </div>
          <p className="text-2xs text-fg-muted">
            תזכורת: המשקלים נשמרים נטו. שדה המוט משמש רק לחישוב הפלטות.
          </p>
        </div>
      </Modal>
    </li>
  );
}

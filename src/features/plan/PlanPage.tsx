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
import { cn } from '@/utils/cn';
import type { Plan, Workout, MuscleGroup, Exercise } from '@/types';
import { draftHasWork } from '@/db/queries';
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

/** Next `order` for a sibling list — max+1, so deletes can't create collisions. */
function nextOrder(items: { order: number }[]): number {
  return 1 + Math.max(-1, ...items.map((i) => i.order));
}

/** Rest time as m:ss — 150s is "2:30", not "3 דק׳". */
function formatRest(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

/** How many logged-but-unsaved sets sit in these workouts' autosaved drafts. */
async function unsavedSetsFor(workoutIds: string[]): Promise<number> {
  const drafts = await db.workoutDrafts.bulkGet(workoutIds);
  return drafts
    .filter((d): d is NonNullable<typeof d> => !!d && draftHasWork(d))
    .reduce(
      (n, d) => n + d.drafts.reduce((m, ex) => m + ex.sets.filter((s) => s.completed).length, 0),
      0,
    );
}

/**
 * Drop the autosaved drafts of deleted workouts — but only the EMPTY ones.
 * A draft holding logged sets is never deleted by a cascade: it snapshots its
 * own workout name/code/plan, so the dashboard can still surface it and
 * `commitDraft` can still file it into history after the workout is gone.
 * Deleting a workout must not be a way to silently lose a session.
 */
async function deleteEmptyDrafts(workoutIds: string[]): Promise<void> {
  const drafts = await db.workoutDrafts.bulkGet(workoutIds);
  const empty = drafts
    .filter((d): d is NonNullable<typeof d> => !!d && !draftHasWork(d))
    .map((d) => d.workoutId);
  if (empty.length > 0) await db.workoutDrafts.bulkDelete(empty);
}

export function PlanPage() {
  const plans = useLiveQuery(() => db.plans.orderBy('order').toArray(), []) ?? [];
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const planId = selectedPlanId ?? plans.find((p) => p.isActive)?.id ?? plans[0]?.id ?? null;
  // Single source of truth: the plan the user is looking at. Never mix with "the active plan".
  const plan = plans.find((p) => p.id === planId) ?? null;

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
      // Adopt it whenever nothing is active — not only when the DB is empty,
      // or deleting the active plan leaves the app with no active plan at all.
      isActive: !plans.some((x) => x.isActive),
      order: nextOrder(plans),
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
          order: nextOrder(plans),
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
    const workoutIds = (await db.workouts.where('planId').equals(p.id).toArray()).map((w) => w.id);
    const unsaved = await unsavedSetsFor(workoutIds);
    const ok = await confirmDialog({
      title: `למחוק את "${p.name}"?`,
      body:
        'הפעולה תמחק את התכנית ואת כל האימונים שלה. אימונים שכבר נשמרו לא יושפעו.' +
        (unsaved > 0
          ? ` יש אימון פתוח עם ${unsaved} סטים שטרם נשמרו — הוא יישאר במסך הבית לשמירה.`
          : ''),
      destructive: true,
      confirmLabel: 'מחק',
    });
    if (!ok) return;
    await db.transaction(
      'rw',
      [db.plans, db.workouts, db.muscleGroups, db.exercises, db.workoutDrafts],
      async () => {
        const ws = await db.workouts.where('planId').equals(p.id).toArray();
        for (const w of ws) {
          const gs = await db.muscleGroups.where('workoutId').equals(w.id).toArray();
          for (const g of gs) {
            await db.exercises.where('muscleGroupId').equals(g.id).delete();
          }
          await db.muscleGroups.where('workoutId').equals(w.id).delete();
        }
        await deleteEmptyDrafts(ws.map((w) => w.id));
        await db.workouts.where('planId').equals(p.id).delete();
        await db.plans.delete(p.id);
        // Exactly one plan must always be active, or the dashboard and the
        // logger fall back to different plans.
        const rest = await db.plans.orderBy('order').toArray();
        if (rest.length > 0 && !rest.some((x) => x.isActive)) {
          await db.plans.update(rest[0]!.id, { isActive: true, updatedAt: now() });
        }
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
      <header className="mb-3 flex items-start justify-between gap-2 px-1">
        <div className="min-w-0">
          <p className="eyebrow">תכנית אימונים</p>
          <h1 className="text-2xl font-extrabold truncate">{plan?.name ?? 'תכנית'}</h1>
        </div>
        <button onClick={addPlan} className="btn-ghost !min-h-9 !px-2.5 text-xs shrink-0">
          <IconPlus size={14} /> תכנית
        </button>
      </header>

      {/* The plan switcher is a chip track: one recessed groove with the active
          pill riding on top, same as the segmented controls elsewhere. */}
      {plans.length > 0 && (
        <div className="field mb-3 flex gap-1 overflow-x-auto no-scrollbar rounded-full p-1">
          {plans.map((p) => (
            <button
              key={p.id}
              data-active={p.id === planId}
              onClick={() => setSelectedPlanId(p.id)}
              className="pill-tab shrink-0"
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
          {/* The h1 already carries the plan's identity, so this card is its
              description plus the three plan-level actions — dimmed, because
              they are not what the user came here to read. */}
          {plan && (
            <div className="card mb-4 p-2 ps-3">
              <div className="flex items-center gap-1">
                <div className="min-w-0 flex-1 pe-1">
                  {/* The h1 and the switcher pill both name this plan already —
                      here the name is only a confirmation, and the description
                      is the part that carries information. */}
                  <p className="eyebrow truncate">{plan.name}</p>
                  {plan.description && (
                    <p className="mt-1 line-clamp-2 text-xs text-fg-muted">{plan.description}</p>
                  )}
                </div>
                <button
                  className="btn-icon text-fg-dim hover:text-fg"
                  aria-label="ערוך תכנית"
                  onClick={() => {
                    setEditPlanDraft(plan);
                    setEditPlanOpen(true);
                  }}
                >
                  <IconEdit size={17} />
                </button>
                <button
                  className="btn-icon text-fg-dim hover:text-fg"
                  aria-label="שכפל"
                  onClick={() => duplicatePlan(plan)}
                >
                  <IconCopy size={17} />
                </button>
                <button
                  className="btn-icon text-fg-ghost hover:text-bad"
                  aria-label="מחק תכנית"
                  onClick={() => deletePlan(plan)}
                >
                  <IconTrash size={17} />
                </button>
              </div>
              {!plan.isActive && (
                <button
                  className="btn-ghost mt-2 w-full !min-h-10 text-xs"
                  onClick={() => setActive(plan)}
                >
                  הגדר כפעילה
                </button>
              )}
            </div>
          )}

          <Section
            title="אימונים"
            action={
              planId && (
                <button
                  className="btn-ghost !min-h-9 !px-2.5 text-xs"
                  onClick={async () => {
                    const t = now();
                    const order = nextOrder(workouts);
                    await db.workouts.add({
                      id: newId(),
                      planId,
                      name: 'אימון חדש',
                      code: `W${order + 1}`,
                      order,
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
                  <div className="space-y-2.5">
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
                  name: editPlanDraft.name.trim() || plan?.name || 'תכנית',
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
    <div
      ref={setNodeRef}
      style={style}
      className={cn('card overflow-hidden', expanded && 'shadow-raised')}
    >
      {/* The workout's code is set as a display figure in accent, the way the
          dashboard's next-workout card sets it — same object, same treatment. */}
      <div className="flex items-center gap-0.5 p-1.5">
        <button
          type="button"
          className="btn-icon text-fg-ghost hover:text-fg-muted touch-none"
          {...attributes}
          {...listeners}
          aria-label="גרור"
        >
          <IconGrip size={17} />
        </button>
        <button
          className="flex-1 min-w-0 text-right flex items-center gap-1.5 py-1"
          onClick={() => setExpanded((v) => !v)}
        >
          <div className="flex-1 min-w-0">
            {/* Keep the code span + bare name text node exactly as they were:
                this button's accessible name is asserted with an anchored
                regex (^<code><name>), and extra element boundaries can change
                how the name is joined. */}
            <p className="truncate text-sm font-bold leading-tight">
              {/* Symmetric margin, not `me-`: the code and a Latin workout name
                  merge into one bidi run, so a logical-end margin lands on the
                  far side of the pair and the two render jammed together. */}
              <span className="num-display text-base font-semibold text-accent-text mx-2">
                {workout.code}
              </span>
              {workout.name}
            </p>
            <p className="mt-1 text-2xs text-fg-dim">
              מנוחה ברירת מחדל: {formatRest(workout.defaultRestSec)} דק׳
            </p>
          </div>
          <IconChevronDown
            size={18}
            className={cn(
              'shrink-0 text-fg-dim transition-transform duration-150',
              expanded && 'rotate-180 text-fg-muted',
            )}
          />
        </button>
        <button
          className="btn-icon text-fg-dim hover:text-fg"
          aria-label="ערוך"
          onClick={() => {
            setDraft(workout);
            setEditOpen(true);
          }}
        >
          <IconEdit size={17} />
        </button>
        <button
          className="btn-icon text-fg-ghost hover:text-bad"
          aria-label="מחק אימון"
          onClick={async () => {
            const unsaved = await unsavedSetsFor([workout.id]);
            const ok = await confirmDialog({
              title: `למחוק "${workout.name}"?`,
              body:
                'יימחקו גם קבוצות השרירים והתרגילים שמתחת לאימון זה.' +
                (unsaved > 0
                  ? ` יש כאן אימון פתוח עם ${unsaved} סטים שטרם נשמרו — הוא יישאר במסך הבית לשמירה.`
                  : ''),
              destructive: true,
              confirmLabel: 'מחק',
            });
            if (!ok) return;
            await db.transaction(
              'rw',
              [db.workouts, db.muscleGroups, db.exercises, db.workoutDrafts],
              async () => {
                const gs = await db.muscleGroups.where('workoutId').equals(workout.id).toArray();
                for (const g of gs) {
                  await db.exercises.where('muscleGroupId').equals(g.id).delete();
                }
                await db.muscleGroups.where('workoutId').equals(workout.id).delete();
                await deleteEmptyDrafts([workout.id]);
                await db.workouts.delete(workout.id);
              },
            );
          }}
        >
          <IconTrash size={17} />
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
                  name: draft.name.trim() || workout.name,
                  code: draft.code.trim() || workout.code,
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
      order: nextOrder(groups),
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
    // The body of an open workout is CARVED IN — darker than the card that owns
    // it, with the inset edge. That one inversion is what makes the muscle
    // groups and exercises read as contents rather than as more cards.
    <div className="border-t border-line-muted bg-ink-950 px-2 py-2.5 shadow-field">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDrag}>
        <SortableContext items={groups.map((g) => g.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-3">
            {groups.map((g) => (
              <MuscleGroupCard key={g.id} group={g} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <button className="btn-subtle w-full !min-h-11 text-xs mt-3" onClick={addGroup}>
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
    const workout = await db.workouts.get(group.workoutId);
    await db.exercises.add({
      id: newId(),
      muscleGroupId: group.id,
      name: 'תרגיל חדש',
      targetSets: 3,
      targetRepsMin: 6,
      targetRepsMax: 10,
      // Inherit the workout's default rest — otherwise that field is write-only.
      defaultRestSec: workout?.defaultRestSec ?? 120,
      barWeight: 0,
      isMachine: false,
      order: nextOrder(exercises),
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
    // Not a card: a muscle group is a LABEL over a list. Giving it its own
    // raised surface is what made all four levels of the tree look identical.
    <div
      ref={setNodeRef}
      style={style}
      className={cn(isDragging && 'rounded-2xl bg-ink-950 shadow-card')}
    >
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          className="btn-icon text-fg-ghost hover:text-fg-muted touch-none"
          {...attributes}
          {...listeners}
          aria-label="גרור"
        >
          <IconGrip size={14} />
        </button>
        {editing ? (
          // Rename commits on Enter (the iOS return key) only; any other blur reverts,
          // so tapping the trash can't silently persist a half-typed name.
          <input
            className="input !py-1 text-sm flex-1"
            value={editName}
            autoFocus
            onChange={(e) => setEditName(e.target.value)}
            onBlur={() => {
              setEditName(group.name);
              setEditing(false);
            }}
            onKeyDown={async (e) => {
              if (e.key === 'Enter') {
                await db.muscleGroups.update(group.id, { name: editName.trim() || group.name });
                setEditing(false);
              }
              if (e.key === 'Escape') setEditing(false);
            }}
          />
        ) : (
          <button
            className="eyebrow flex-1 min-w-0 truncate text-right min-h-11 text-fg-muted hover:text-fg transition-colors"
            onClick={() => {
              setEditName(group.name);
              setEditing(true);
            }}
          >
            {group.name}
          </button>
        )}
        {!editing && (
          <span className="num shrink-0 px-1 text-2xs text-fg-ghost">{exercises.length}</span>
        )}
        <button
          className="btn-icon text-fg-ghost hover:text-bad"
          aria-label="מחק קבוצת שרירים"
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
      {exercises.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEx}>
          <SortableContext items={exercises.map((e) => e.id)} strategy={verticalListSortingStrategy}>
            {/* One raised block per group, hairline-divided — a list, not a
                stack of tiles. No overflow-hidden: it would clip a dragged row. */}
            <ul className="card-flat mt-1 divide-y divide-line-muted">
              {exercises.map((ex) => (
                <ExerciseRow key={ex.id} ex={ex} />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
      <button className="btn-subtle w-full !min-h-10 text-2xs mt-1.5" onClick={addExercise}>
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
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        'pb-1.5',
        // Only a lifted row gets its own surface; at rest it is part of the list.
        isDragging && 'rounded-xl bg-ink-850 shadow-card',
      )}
    >
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          className="btn-icon text-fg-ghost hover:text-fg-muted touch-none"
          {...attributes}
          {...listeners}
          aria-label="גרור"
        >
          <IconGrip size={14} />
        </button>
        <p className="flex-1 min-w-0 truncate text-sm font-medium">{ex.name}</p>
        <button
          className="btn-icon text-fg-dim hover:text-fg"
          aria-label="ערוך"
          onClick={() => {
            setDraft(ex);
            setEditOpen(true);
          }}
        >
          <IconEdit size={15} />
        </button>
        <button
          className="btn-icon text-fg-ghost hover:text-bad"
          aria-label="מחק תרגיל"
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
          <IconTrash size={15} />
        </button>
      </div>

      {/* The prescription facts get the full width of the row rather than the
          scrap left over between three icon buttons — the set×rep target
          carries the weight, everything else recedes behind it. */}
      {/* Every numeric token is `dir="ltr"`-isolated: at RTL base level the bidi
          algorithm reorders "3×10-12" into "10-12×3", which reads as a
          completely different prescription. Hebrew words stay OUT of `.num` —
          the mono face has no Hebrew and falls back to spaced-out glyphs. */}
      <p className="-mt-1.5 ps-11 pe-2 text-2xs leading-snug text-fg-dim">
        <span dir="ltr" className="num font-semibold text-fg-muted">
          {`${ex.targetSets}×${ex.targetRepsMin}-${ex.targetRepsMax}`}
        </span>
        {ex.barWeight > 0 && (
          <>
            {' · מוט '}
            <span dir="ltr" className="num">{`${ex.barWeight}kg`}</span>
          </>
        )}
        {ex.isMachine && ' · מכונה'}
        {' · מנוחה '}
        <span dir="ltr" className="num">
          {formatRest(ex.defaultRestSec)}
        </span>
        {ex.incrementKg !== undefined && (
          <>
            {' · קפיצה '}
            <span dir="ltr" className="num text-accent-text/80">{`${ex.incrementKg}kg`}</span>
          </>
        )}
      </p>

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
                // A backwards range (min 12, max 6) is a typo, not a request to
                // discard one of the two numbers — keep both and swap them.
                await db.exercises.update(ex.id, {
                  name: draft.name.trim() || ex.name,
                  targetSets: draft.targetSets,
                  targetRepsMin: Math.min(draft.targetRepsMin, draft.targetRepsMax),
                  targetRepsMax: Math.max(draft.targetRepsMin, draft.targetRepsMax),
                  defaultRestSec: draft.defaultRestSec,
                  barWeight: draft.barWeight,
                  isMachine: draft.isMachine ?? false,
                  incrementKg: draft.incrementKg,
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
            <div>
              <label className="label">קפיצת משקל (kg)</label>
              <NumberInput
                value={draft.incrementKg ?? ''}
                onChange={(v) =>
                  setDraft({
                    ...draft,
                    incrementKg: v === '' || Number(v) <= 0 ? undefined : Number(v),
                  })
                }
                min={0}
                step={0.25}
                decimals={2}
                withSteppers
                placeholder="אוטומטי"
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

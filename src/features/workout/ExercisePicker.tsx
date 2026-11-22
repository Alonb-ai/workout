import { useEffect, useMemo, useState } from 'react';
import { IconBarbell, IconPlus, IconSearch } from '@/components/Icon';
import { db } from '@/db/db';
import { historySummary, isLive } from '@/db/exerciseLibrary';
import {
  EXERCISE_CATALOG,
  MUSCLE_LABEL,
  inferMuscles,
  rankSimilar,
  sameExerciseName,
  type CatalogExercise,
} from '@/utils/exerciseCatalog';
import { formatHebDateShort } from '@/utils/dates';
import type { Exercise, MuscleGroup, MuscleTag } from '@/types';
import { cn } from '@/utils/cn';

/** One exercise row the user can pick, with where it lives. */
export interface PickRow {
  exercise: Exercise;
  /** Undefined for an archived exercise whose group no longer exists. */
  group: MuscleGroup | undefined;
  workoutName: string;
  isInCurrentWorkout: boolean;
  archived: boolean;
  sessions: number;
  lastDate: string | null;
}

export type PickChoice =
  | { kind: 'existing'; row: PickRow }
  | { kind: 'catalog'; entry: CatalogExercise };

export interface PickerReference {
  name: string;
  muscles?: MuscleTag[];
  groupName?: string;
  isMachine?: boolean;
}

/**
 * Loads every exercise the user can pick for a session in `workoutId`: the
 * plan's live exercises (any workout) plus the archived library.
 */
export function usePickRows(open: boolean, workoutId: string): PickRow[] | null {
  const [rows, setRows] = useState<PickRow[] | null>(null);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const workout = await db.workouts.get(workoutId);
      const planWorkouts = workout
        ? await db.workouts.where('planId').equals(workout.planId).sortBy('order')
        : [];
      const workoutById = new Map(planWorkouts.map((w) => [w.id, w]));
      const allGroups = await db.muscleGroups.toArray();
      const groupById = new Map(allGroups.map((g) => [g.id, g]));
      const all = (await db.exercises.toArray()).filter((e) => e.mergedInto === undefined);

      const candidates = all.filter((e) => {
        if (e.archivedAt !== undefined) return true;
        const g = groupById.get(e.muscleGroupId);
        return !!g && workoutById.has(g.workoutId);
      });
      const summary = await historySummary(candidates);

      const out: PickRow[] = candidates.map((e) => {
        const g = groupById.get(e.muscleGroupId);
        const w = g ? workoutById.get(g.workoutId) : undefined;
        const s = summary.get(e.id);
        return {
          exercise: e,
          group: g,
          workoutName: w?.name ?? e.archivedFrom?.workoutName ?? '',
          isInCurrentWorkout: !!g && g.workoutId === workoutId && isLive(e),
          archived: !isLive(e),
          sessions: s?.sessions ?? 0,
          lastDate: s?.lastDate ?? null,
        };
      });
      out.sort((a, b) => {
        if (a.isInCurrentWorkout !== b.isInCurrentWorkout) return a.isInCurrentWorkout ? -1 : 1;
        if (a.archived !== b.archived) return a.archived ? 1 : -1;
        if (a.archived) return (b.lastDate ?? '').localeCompare(a.lastDate ?? '');
        const ga = a.group?.order ?? 0;
        const gb = b.group?.order ?? 0;
        if (ga !== gb) return ga - gb;
        return a.exercise.order - b.exercise.order;
      });
      if (!cancelled) setRows(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, workoutId]);
  return rows;
}

function describeRow(r: PickRow): PickerReference {
  return {
    name: r.exercise.name,
    ...(r.exercise.muscles ? { muscles: r.exercise.muscles } : {}),
    groupName: r.group?.name ?? r.exercise.archivedFrom?.groupName ?? '',
    ...(r.exercise.isMachine ? { isMachine: true } : {}),
  };
}

/** Short workout label: "יום 2 — גב · ביצפס" → "יום 2". */
function shortWorkout(name: string): string {
  return name.split('—')[0]?.trim() ?? name;
}

/**
 * Search + pick list shared by "add exercise" and "swap exercise".
 *
 * With a `reference` (swap), the top section is "מתאימים" — the user's own
 * exercises that train the same muscles, best match first, then new ideas
 * from the built-in catalog. Without one (add), the list is the plan and the
 * library, and the catalog only joins in once the user searches.
 */
export function ExercisePicker({
  rows,
  excludeIds,
  reference,
  onPick,
}: {
  rows: PickRow[] | null;
  excludeIds: Set<string>;
  reference?: PickerReference;
  onPick: (choice: PickChoice) => void;
}) {
  const [search, setSearch] = useState('');
  const q = search.trim().toLowerCase();

  const available = useMemo(
    () => (rows ?? []).filter((r) => !excludeIds.has(r.exercise.id)),
    [rows, excludeIds],
  );

  const { suggested, rest, catalog } = useMemo(() => {
    const matches = (name: string, extra = '') =>
      q === '' || name.toLowerCase().includes(q) || extra.toLowerCase().includes(q);
    const own = available.filter((r) =>
      matches(r.exercise.name, `${r.group?.name ?? ''} ${r.exercise.archivedFrom?.groupName ?? ''}`),
    );
    let suggestedRows: PickRow[] = [];
    if (reference) {
      suggestedRows = rankSimilar(reference, own, describeRow)
        .slice(0, q ? 20 : 6)
        .map((c) => c.item);
    }
    const suggestedIds = new Set(suggestedRows.map((r) => r.exercise.id));
    const restRows = own.filter((r) => !suggestedIds.has(r.exercise.id));

    // Catalog ideas never duplicate something the user already has.
    const owned = (rows ?? []).map((r) => r.exercise.name);
    const fresh = EXERCISE_CATALOG.filter(
      (c) =>
        !owned.some((n) => sameExerciseName(n, c.name)) &&
        matches(c.name, c.muscles.map((m) => MUSCLE_LABEL[m]).join(' ')),
    );
    let catalogRows: CatalogExercise[] = [];
    if (reference) {
      catalogRows = rankSimilar(reference, fresh, (c) => ({
        name: c.name,
        muscles: c.muscles,
        ...(c.isMachine ? { isMachine: true } : {}),
      }))
        .slice(0, q ? 12 : 5)
        .map((c) => c.item);
    } else if (q) {
      catalogRows = fresh.slice(0, 12);
    }
    return { suggested: suggestedRows, rest: restRows, catalog: catalogRows };
  }, [available, rows, reference, q]);

  const refMuscles = reference ? inferMuscles(reference) : [];

  if (rows === null) {
    return <p className="py-8 text-center text-sm text-fg-muted">טוען…</p>;
  }

  return (
    <>
      <div className="relative mb-3">
        <IconSearch
          size={18}
          className="absolute top-1/2 -translate-y-1/2 start-3.5 text-fg-dim pointer-events-none"
        />
        <input
          className="input ps-11 !min-h-12 text-base"
          placeholder="חיפוש לפי שם או קבוצת שריר…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="max-h-[55vh] overflow-y-auto space-y-3 pb-1">
        {reference && (
          <div>
            <p className="eyebrow mb-1.5 px-1">
              מתאימים
              {refMuscles.length > 0 && (
                <span className="normal-case text-fg-dim">
                  {' · '}
                  {refMuscles.slice(0, 3).map((m) => MUSCLE_LABEL[m]).join(', ')}
                </span>
              )}
            </p>
            {suggested.length === 0 && catalog.length === 0 ? (
              <p className="px-1 text-2xs text-fg-dim">
                לא נמצאו תרגילים דומים. אפשר לבחור מהרשימה למטה.
              </p>
            ) : (
              <PickList>
                {suggested.map((r) => (
                  <ExistingRow key={r.exercise.id} row={r} onPick={() => onPick({ kind: 'existing', row: r })} />
                ))}
                {catalog.map((c) => (
                  <CatalogRow key={c.name} entry={c} onPick={() => onPick({ kind: 'catalog', entry: c })} />
                ))}
              </PickList>
            )}
          </div>
        )}

        {rest.length > 0 && (
          <div>
            {reference && <p className="eyebrow mb-1.5 px-1">כל התרגילים</p>}
            <PickList>
              {rest.map((r) => (
                <ExistingRow key={r.exercise.id} row={r} onPick={() => onPick({ kind: 'existing', row: r })} />
              ))}
            </PickList>
          </div>
        )}

        {!reference && catalog.length > 0 && (
          <div>
            <p className="eyebrow mb-1.5 px-1">רעיונות לתרגילים חדשים</p>
            <PickList>
              {catalog.map((c) => (
                <CatalogRow key={c.name} entry={c} onPick={() => onPick({ kind: 'catalog', entry: c })} />
              ))}
            </PickList>
          </div>
        )}

        {rest.length === 0 && suggested.length === 0 && catalog.length === 0 && (
          <p className="text-center text-sm text-fg-muted py-8">
            {available.length === 0
              ? 'כל התרגילים כבר באימון. נסו "תרגיל חדש".'
              : 'לא נמצא. נסו "תרגיל חדש".'}
          </p>
        )}
      </div>
    </>
  );
}

function PickList({ children }: { children: React.ReactNode }) {
  return <ul className="card overflow-hidden divide-y divide-line">{children}</ul>;
}

function ExistingRow({ row, onPick }: { row: PickRow; onPick: () => void }) {
  const where = row.archived
    ? `ספרייה${row.workoutName ? ` · היה ב${shortWorkout(row.workoutName)}` : ''}`
    : `${row.group?.name ?? ''}${!row.isInCurrentWorkout && row.workoutName ? ` · מאימון: ${shortWorkout(row.workoutName)}` : ''}`;
  return (
    <li>
      <button
        className="w-full text-right px-3 py-2.5 min-h-[56px] hover:bg-ink-800 active:bg-ink-800 transition-colors flex items-center gap-3"
        onClick={onPick}
      >
        <span
          className={cn(
            'w-9 h-9 rounded-xl bg-ink-800 border border-line-muted flex items-center justify-center shrink-0',
            row.archived ? 'text-fg-dim' : 'text-accent-text',
          )}
        >
          <IconBarbell size={16} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{row.exercise.name}</p>
          <p className="text-2xs text-fg-dim truncate">
            {where}
            {row.sessions > 0 && row.lastDate
              ? ` · ${row.sessions} אימונים, אחרון ${formatHebDateShort(row.lastDate)}`
              : ''}
          </p>
        </div>
        <span className="num text-2xs text-fg-muted shrink-0">
          {row.exercise.targetSets}×{row.exercise.targetRepsMin}-{row.exercise.targetRepsMax}
        </span>
        <IconPlus size={18} className="text-accent-text shrink-0" />
      </button>
    </li>
  );
}

function CatalogRow({ entry, onPick }: { entry: CatalogExercise; onPick: () => void }) {
  return (
    <li>
      <button
        className="w-full text-right px-3 py-2.5 min-h-[56px] hover:bg-ink-800 active:bg-ink-800 transition-colors flex items-center gap-3"
        onClick={onPick}
      >
        <span className="w-9 h-9 rounded-xl field text-info flex items-center justify-center shrink-0">
          <IconPlus size={16} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{entry.name}</p>
          <p className="text-2xs text-fg-dim truncate">
            חדש · {entry.muscles.slice(0, 2).map((m) => MUSCLE_LABEL[m]).join(', ')}
          </p>
        </div>
        <span className="num text-2xs text-fg-muted shrink-0">
          {entry.repsMin}-{entry.repsMax}
        </span>
      </button>
    </li>
  );
}

/**
 * The muscle group a picked row should be logged under. An archived exercise
 * whose group was deleted gets a stand-in carrying the name it was filed
 * under — it only feeds the log's `muscleGroupName` snapshot.
 */
export function groupForRow(row: PickRow): MuscleGroup {
  return (
    row.group ?? {
      id: row.exercise.muscleGroupId,
      workoutId: '',
      name: row.exercise.archivedFrom?.groupName || 'ספריית תרגילים',
      order: 0,
    }
  );
}

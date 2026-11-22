import type { Table } from 'dexie';
import { db, newId, now } from './db';
import type { Exercise, ID } from '@/types';
import { historyIdsOf, isLive, repairExerciseLinks, type RepairReport } from './repair';

export { historyIdsOf, isLive };

/**
 * Exercise lifecycle: archive / restore / move / swap / link history.
 *
 * The rule that runs through all of it: an exercise row that has history is
 * never deleted. Logs point at the row by id, and the row is what makes that
 * history findable (history page, progression, stall detection). "Remove from
 * the plan" therefore means ARCHIVE — the row stays, it just stops being loaded
 * into sessions. Only rows nothing points at are hard-deleted.
 */

const LIFECYCLE_TABLES = () => [
  db.exercises,
  db.muscleGroups,
  db.workouts,
  db.exerciseLogs,
  db.workoutDrafts,
];

/** Where an exercise currently sits, as display text. */
async function locate(ex: Exercise): Promise<{ workoutName: string; groupName: string }> {
  const group = ex.muscleGroupId ? await db.muscleGroups.get(ex.muscleGroupId) : undefined;
  const workout = group ? await db.workouts.get(group.workoutId) : undefined;
  return { workoutName: workout?.name ?? '', groupName: group?.name ?? '' };
}

/**
 * Ids (from `ids`) that something still points at: a saved log, an open
 * draft, or linked history. Those must be archived, never deleted.
 */
async function idsInUse(ids: ID[]): Promise<Set<ID>> {
  const used = new Set<ID>();
  if (ids.length === 0) return used;
  const logs = await db.exerciseLogs.where('exerciseId').anyOf(ids).toArray();
  for (const l of logs) used.add(l.exerciseId);
  const drafts = await db.workoutDrafts.toArray();
  for (const d of drafts) for (const ex of d.drafts) if (ids.includes(ex.exerciseId)) used.add(ex.exerciseId);
  const rows = await db.exercises.bulkGet(ids);
  for (const r of rows) if (r && (r.historyIds?.length ?? 0) > 0) used.add(r.id);
  return used;
}

/** Take exercises out of the plan, keeping their rows (and history). */
export async function archiveExercises(ids: ID[]): Promise<void> {
  await db.transaction('rw', LIFECYCLE_TABLES(), async () => {
    const t = now();
    for (const id of ids) {
      const ex = await db.exercises.get(id);
      if (!ex || ex.archivedAt !== undefined) continue;
      await db.exercises.update(id, { archivedAt: t, archivedFrom: await locate(ex), updatedAt: t });
    }
  });
}

/**
 * What deleting a workout / muscle group / plan does to its exercises:
 * those with history are archived, the rest are deleted. Must run BEFORE the
 * parent rows are deleted (it records where each exercise came from).
 * Returns how many were archived, for the confirmation toast.
 */
export async function retireExercises(ids: ID[]): Promise<number> {
  if (ids.length === 0) return 0;
  return db.transaction('rw', LIFECYCLE_TABLES(), async () => {
    const used = await idsInUse(ids);
    const keep = ids.filter((id) => used.has(id));
    const drop = ids.filter((id) => !used.has(id));
    await archiveExercises(keep);
    if (drop.length > 0) await db.exercises.bulkDelete(drop);
    return keep.length;
  });
}

/** Delete or archive a single exercise depending on whether it has history. */
export async function removeExerciseFromPlan(id: ID): Promise<'archived' | 'deleted'> {
  const archived = await retireExercises([id]);
  return archived > 0 ? 'archived' : 'deleted';
}

async function nextOrderIn(groupId: ID, excludeId?: ID): Promise<number> {
  const siblings = (await db.exercises.where('muscleGroupId').equals(groupId).toArray()).filter(
    (e) => e.id !== excludeId && isLive(e),
  );
  return 1 + Math.max(-1, ...siblings.map((e) => e.order));
}

/** Put an exercise (archived or live elsewhere) at the end of a muscle group. */
export async function placeExercise(id: ID, groupId: ID): Promise<void> {
  await db.transaction('rw', [db.exercises], async () => {
    const order = await nextOrderIn(groupId, id);
    await db.exercises.update(id, {
      muscleGroupId: groupId,
      order,
      archivedAt: undefined,
      archivedFrom: undefined,
      updatedAt: now(),
    });
  });
}

/**
 * Permanent swap: `incomingId` takes `outgoingId`'s slot (group + position)
 * and `outgoingId` is archived. Both keep their own history.
 */
export async function swapInPlan(outgoingId: ID, incomingId: ID): Promise<void> {
  if (outgoingId === incomingId) return;
  await db.transaction('rw', LIFECYCLE_TABLES(), async () => {
    const out = await db.exercises.get(outgoingId);
    const inc = await db.exercises.get(incomingId);
    if (!out || !inc) throw new Error('exercise not found');
    const t = now();
    await db.exercises.update(outgoingId, {
      archivedAt: t,
      archivedFrom: await locate(out),
      updatedAt: t,
    });
    await db.exercises.update(incomingId, {
      muscleGroupId: out.muscleGroupId,
      order: out.order,
      archivedAt: undefined,
      archivedFrom: undefined,
      mergedInto: undefined,
      updatedAt: t,
    });
  });
}

/**
 * Fold `sourceId`'s history into `targetId` (e.g. an old variant under a
 * slightly different name). Non-destructive: no log is rewritten, the target
 * just starts reading the source's logs too, and the source is hidden.
 * `unlinkHistory` reverses it exactly.
 */
export async function linkHistory(sourceId: ID, targetId: ID): Promise<void> {
  if (sourceId === targetId) return;
  await db.transaction('rw', [db.exercises], async () => {
    const src = await db.exercises.get(sourceId);
    const tgt = await db.exercises.get(targetId);
    if (!src || !tgt) throw new Error('exercise not found');
    const ids = new Set([...(tgt.historyIds ?? []), ...historyIdsOf(src)]);
    ids.delete(targetId);
    const t = now();
    await db.exercises.update(targetId, { historyIds: [...ids], updatedAt: t });
    await db.exercises.update(sourceId, {
      mergedInto: targetId,
      archivedAt: src.archivedAt ?? t,
      ...(src.archivedAt === undefined ? { archivedFrom: await locate(src) } : {}),
      updatedAt: t,
    });
  });
}

export async function unlinkHistory(targetId: ID, sourceId: ID): Promise<void> {
  await db.transaction('rw', [db.exercises], async () => {
    const tgt = await db.exercises.get(targetId);
    const src = await db.exercises.get(sourceId);
    if (!tgt) return;
    const drop = new Set(src ? historyIdsOf(src) : [sourceId]);
    await db.exercises.update(targetId, {
      historyIds: (tgt.historyIds ?? []).filter((h) => !drop.has(h)),
      updatedAt: now(),
    });
    if (src) await db.exercises.update(sourceId, { mergedInto: undefined, updatedAt: now() });
  });
}

/** Hard-delete an archived exercise. Refused when anything points at it. */
export async function deleteArchivedExercise(id: ID): Promise<boolean> {
  return db.transaction('rw', LIFECYCLE_TABLES(), async () => {
    const used = await idsInUse([id]);
    if (used.has(id)) return false;
    await db.exercises.delete(id);
    return true;
  });
}

/** Saved-session count and last date per exercise (own logs + linked). */
export async function historySummary(
  exercises: Exercise[],
): Promise<Map<ID, { sessions: number; lastDate: string | null }>> {
  const [logs, sessions] = await Promise.all([db.exerciseLogs.toArray(), db.sessions.toArray()]);
  const done = new Map(sessions.filter((s) => s.status === 'completed').map((s) => [s.id, s]));
  const byExId = new Map<ID, { sessionIds: Set<ID>; lastDate: string | null }>();
  for (const l of logs) {
    const s = done.get(l.sessionId);
    if (!s) continue;
    const cur = byExId.get(l.exerciseId) ?? { sessionIds: new Set<ID>(), lastDate: null };
    cur.sessionIds.add(s.id);
    if (!cur.lastDate || s.date > cur.lastDate) cur.lastDate = s.date;
    byExId.set(l.exerciseId, cur);
  }
  const out = new Map<ID, { sessions: number; lastDate: string | null }>();
  for (const ex of exercises) {
    const ids = new Set<ID>();
    let lastDate: string | null = null;
    for (const hid of historyIdsOf(ex)) {
      const h = byExId.get(hid);
      if (!h) continue;
      h.sessionIds.forEach((x) => ids.add(x));
      if (h.lastDate && (!lastDate || h.lastDate > lastDate)) lastDate = h.lastDate;
    }
    out.set(ex.id, { sessions: ids.size, lastDate });
  }
  return out;
}

/** A new exercise row. Archived when it is a one-off for a single session. */
export async function createExercise(
  fields: Omit<Exercise, 'id' | 'order' | 'createdAt' | 'updatedAt'>,
  opts: { oneOff: boolean; workoutName?: string; groupName?: string },
): Promise<Exercise> {
  const t = now();
  const group = fields.muscleGroupId ? await db.muscleGroups.get(fields.muscleGroupId) : undefined;
  const workout = group ? await db.workouts.get(group.workoutId) : undefined;
  const ex: Exercise = {
    ...fields,
    id: newId(),
    order: fields.muscleGroupId ? await nextOrderIn(fields.muscleGroupId) : 0,
    ...(opts.oneOff
      ? {
          archivedAt: t,
          archivedFrom: {
            workoutName: workout?.name ?? opts.workoutName ?? '',
            groupName: group?.name ?? opts.groupName ?? '',
          },
        }
      : {}),
    createdAt: t,
    updatedAt: t,
  };
  await db.exercises.add(ex);
  return ex;
}

/** Run the repair against the live database (after an import). */
export async function repairLiveDatabase(): Promise<RepairReport> {
  return db.transaction('rw', [db.exercises, db.exerciseLogs, db.sessions], () =>
    repairExerciseLinks(<T,>(name: string) => db.table(name) as unknown as Table<T, string>),
  );
}

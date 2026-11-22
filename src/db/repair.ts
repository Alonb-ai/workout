import type { Table } from 'dexie';
import type { Exercise, ExerciseLog, ID, Session } from '@/types';
import { sameExerciseName } from '@/utils/exerciseCatalog';

/**
 * Pure-ish helpers shared by the Dexie upgrade and the exercise library.
 * Deliberately does NOT import `./db` — `db.ts` imports this file for the v6
 * upgrade, and a cycle there would hand the upgrade an uninitialised module.
 */

/** Every exercise id whose logs belong to this exercise's history. */
export function historyIdsOf(ex: Pick<Exercise, 'id' | 'historyIds'>): ID[] {
  return [ex.id, ...(ex.historyIds ?? []).filter((h) => h !== ex.id)];
}

/** In the plan's lineup: not archived and not folded into another exercise. */
export function isLive(ex: Pick<Exercise, 'archivedAt' | 'mergedInto'>): boolean {
  return ex.archivedAt === undefined && ex.mergedInto === undefined;
}

// ============================================================================
// Repair: re-attach logs whose exercise row was deleted by older versions.
// ============================================================================

export interface RepairReport {
  /** Orphan exercise ids linked into a live exercise with the same name. */
  linked: { orphanId: ID; intoId: ID; name: string }[];
  /** Orphan exercise ids given back an (archived) row of their own. */
  restored: { id: ID; name: string }[];
}

export type TableGetter = <T>(name: string) => Table<T, string>;

/**
 * Older versions hard-deleted exercises, leaving their logs pointing at ids
 * with no row — the history existed in the database but no screen could reach
 * it, and progression for a re-added lift of the same name started from zero.
 *
 * For every such orphan id:
 *  - if exactly one exercise has the same name (ignoring case/punctuation) and
 *    the two were never logged in the same session, link the orphan's history
 *    into it (`historyIds`) — no log is rewritten;
 *  - otherwise recreate an ARCHIVED exercise row under the orphan's own id,
 *    from the latest log's snapshot, so it appears in the exercise library
 *    with its history and can be restored or linked by hand.
 *
 * Idempotent. Takes a table getter so it runs both inside a Dexie upgrade
 * (`tx.table`) and after an import (`db.table`).
 */
export async function repairExerciseLinks(table: TableGetter): Promise<RepairReport> {
  const report: RepairReport = { linked: [], restored: [] };
  const exercises = await table<Exercise>('exercises').toArray();
  const logs = await table<ExerciseLog>('exerciseLogs').toArray();
  const sessions = await table<Session>('sessions').toArray();
  const sessionById = new Map(sessions.map((s) => [s.id, s]));

  const known = new Set<ID>(exercises.map((e) => e.id));
  for (const e of exercises) for (const h of e.historyIds ?? []) known.add(h);

  const orphanLogs = new Map<ID, ExerciseLog[]>();
  for (const l of logs) {
    if (known.has(l.exerciseId)) continue;
    const arr = orphanLogs.get(l.exerciseId) ?? [];
    arr.push(l);
    orphanLogs.set(l.exerciseId, arr);
  }
  if (orphanLogs.size === 0) return report;

  const sessionsOf = (ids: ID[]): Set<ID> =>
    new Set(logs.filter((l) => ids.includes(l.exerciseId)).map((l) => l.sessionId));
  const dateOf = (l: ExerciseLog) => sessionById.get(l.sessionId)?.date ?? '';
  const t = Date.now();

  for (const [orphanId, oLogs] of orphanLogs) {
    oLogs.sort((a, b) => (dateOf(a) < dateOf(b) ? -1 : dateOf(a) > dateOf(b) ? 1 : 0));
    const latest = oLogs[oLogs.length - 1]!;
    const names = new Set(oLogs.map((l) => l.exerciseName));

    const matches = exercises.filter(
      (e) => e.mergedInto === undefined && [...names].some((n) => sameExerciseName(n, e.name)),
    );
    const liveMatches = matches.filter((e) => e.archivedAt === undefined);
    const target = liveMatches.length === 1 ? liveMatches[0] : matches.length === 1 ? matches[0] : undefined;

    if (target) {
      const orphanSessions = new Set(oLogs.map((l) => l.sessionId));
      const clash = [...sessionsOf(historyIdsOf(target))].some((s) => orphanSessions.has(s));
      if (!clash) {
        const historyIds = [...(target.historyIds ?? []), orphanId];
        await table<Exercise>('exercises').update(target.id, { historyIds });
        target.historyIds = historyIds;
        report.linked.push({ orphanId, intoId: target.id, name: target.name });
        continue;
      }
    }

    const first = sessionById.get(oLogs[0]!.sessionId);
    const restored: Exercise = {
      id: orphanId,
      muscleGroupId: '',
      name: latest.exerciseName,
      targetSets: latest.targetSets,
      targetRepsMin: latest.targetRepsMin,
      targetRepsMax: latest.targetRepsMax,
      defaultRestSec: 120,
      barWeight: latest.barWeight ?? 0,
      ...(latest.isMachine ? { isMachine: true } : {}),
      order: 0,
      archivedAt: t,
      archivedFrom: {
        workoutName: sessionById.get(latest.sessionId)?.workoutName ?? '',
        groupName: latest.muscleGroupName,
      },
      createdAt: first?.startedAt ?? t,
      updatedAt: t,
    };
    await table<Exercise>('exercises').add(restored);
    exercises.push(restored);
    report.restored.push({ id: orphanId, name: restored.name });
  }
  return report;
}


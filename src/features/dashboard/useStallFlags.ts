import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import { isLive } from '@/db/repair';
import { getExerciseHistory } from '@/db/queries';
import { detectStall } from '@/utils/stall';
import { findSubstitutes } from '@/utils/insights';
import { statsForExercise } from '@/utils/scoring';
import { deloadOf, pastSetsFromLogs, prescriptionForExercise } from '@/utils/progression';
import type { StallFlag } from '@/types';

export function useStallFlags(): StallFlag[] {
  const flags = useLiveQuery(async () => {
    const exercises = await db.exercises.toArray();
    const settings = await db.settings.get('singleton');
    const groups = await db.muscleGroups.toArray();
    const groupNameById = new Map(groups.map((g) => [g.id, g.name]));
    const out: StallFlag[] = [];
    // Only lifts still in the plan: an archived one is not being trained, so
    // "stalled" would be advice about an exercise the user already dropped.
    for (const ex of exercises.filter(isLive)) {
      // Includes linked history (Exercise.historyIds).
      const history = await getExerciseHistory(ex.id);
      const stats = history.map((h) =>
        statsForExercise(h.session.id, ex.id, h.session.date, h.sets, h.exerciseLog.targetSets),
      );
      const flag = detectStall(stats, ex.name);
      if (!flag) continue;
      // The deload figure comes from the same coach that fills the logger, so
      // the dashboard never says "drop 10%" for a lift the logger is about to
      // push heavier because it is one rep from the top of its range.
      const prescription = prescriptionForExercise(
        ex,
        history.map((h) => pastSetsFromLogs([...h.sets].sort((a, b) => a.setNumber - b.setNumber))),
        settings?.plateInventory ?? [],
      );
      const deload = deloadOf(prescription);
      const substitutes = findSubstitutes(ex.id, exercises, 3, groupNameById).map((s) => ({
        id: s.id,
        name: s.name,
      }));
      out.push({
        ...flag,
        ...(deload ? { deload } : {}),
        ...(substitutes.length > 0 ? { substitutes } : {}),
      });
    }
    return out;
  }, []);
  return flags ?? [];
}

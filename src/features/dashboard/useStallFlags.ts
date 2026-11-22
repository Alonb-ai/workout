import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import { isLive } from '@/db/repair';
import { getExerciseStatsHistory } from '@/db/queries';
import { detectStall } from '@/utils/stall';
import { suggestDeload, findSubstitutes } from '@/utils/insights';
import type { StallFlag } from '@/types';

export function useStallFlags(): StallFlag[] {
  const flags = useLiveQuery(async () => {
    const exercises = await db.exercises.toArray();
    const groups = await db.muscleGroups.toArray();
    const groupNameById = new Map(groups.map((g) => [g.id, g.name]));
    const out: StallFlag[] = [];
    // Only lifts still in the plan: an archived one is not being trained, so
    // "stalled" would be advice about an exercise the user already dropped.
    for (const ex of exercises.filter(isLive)) {
      const stats = await getExerciseStatsHistory(ex.id);
      const flag = detectStall(stats, ex.name);
      if (!flag) continue;
      // Enrich the flag with concrete suggestions so the UI doesn't need to
      // know about the insights module.
      const deload = suggestDeload(stats) ?? undefined;
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

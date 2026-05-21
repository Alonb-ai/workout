import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import { getExerciseStatsHistory } from '@/db/queries';
import { detectStall } from '@/utils/stall';
import type { StallFlag } from '@/types';

export function useStallFlags(): StallFlag[] {
  const flags = useLiveQuery(async () => {
    const exercises = await db.exercises.toArray();
    const out: StallFlag[] = [];
    for (const ex of exercises) {
      const stats = await getExerciseStatsHistory(ex.id);
      const flag = detectStall(stats, ex.name);
      if (flag) out.push(flag);
    }
    return out;
  }, []);
  return flags ?? [];
}

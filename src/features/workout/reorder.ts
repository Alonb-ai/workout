import type { DraftExercise } from './types';

/**
 * Move one exercise inside today's session. Returns a new array with `order`
 * renumbered to match the new position, or the same array when the move is a
 * no-op (out of range, same slot). Session-only: nothing here touches the plan,
 * and saved logs take their order from the session, so history is untouched.
 */
export function moveDraft(drafts: DraftExercise[], from: number, to: number): DraftExercise[] {
  if (from === to) return drafts;
  if (from < 0 || from >= drafts.length || to < 0 || to >= drafts.length) return drafts;
  const next = drafts.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next.map((d, i) => (d.order === i ? d : { ...d, order: i }));
}

/** Move by exercise id, one step up (-1) or down (+1). */
export function stepDraft(drafts: DraftExercise[], exerciseId: string, dir: -1 | 1): DraftExercise[] {
  const from = drafts.findIndex((d) => d.exerciseId === exerciseId);
  if (from < 0) return drafts;
  return moveDraft(drafts, from, from + dir);
}

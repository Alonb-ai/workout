import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import {
  deleteArchivedExercise,
  historySummary,
  isLive,
  linkHistory,
} from '@/db/exerciseLibrary';
import { Section } from '@/components/Section';
import { Modal } from '@/components/Modal';
import { IconChart, IconChevronDown, IconTrash } from '@/components/Icon';
import { confirmDialog } from '@/components/Confirm';
import { toast } from '@/store/toast';
import { rankSimilar } from '@/utils/exerciseCatalog';
import { formatHebDateShort } from '@/utils/dates';
import { cn } from '@/utils/cn';
import type { Exercise } from '@/types';
import { PlaceExerciseModal } from './PlaceExerciseModal';

/**
 * Exercises that are not in the plan right now but keep their history:
 * removed from a workout, used once in a session, or recovered from an older
 * version that deleted them. From here an exercise can go back into the plan,
 * have its history linked into another exercise, or — only when it has no
 * history at all — be deleted for good.
 */
export function ExerciseLibrary({ planId }: { planId: string | null }) {
  const [open, setOpen] = useState(false);
  const [placing, setPlacing] = useState<Exercise | null>(null);
  const [linking, setLinking] = useState<Exercise | null>(null);

  const data = useLiveQuery(async () => {
    const all = await db.exercises.toArray();
    const archived = all.filter((e) => e.archivedAt !== undefined && e.mergedInto === undefined);
    const summary = await historySummary(archived);
    return archived
      .map((e) => ({ exercise: e, ...(summary.get(e.id) ?? { sessions: 0, lastDate: null }) }))
      .sort((a, b) => (b.lastDate ?? '').localeCompare(a.lastDate ?? '') || a.exercise.name.localeCompare(b.exercise.name));
  }, []);

  const rows = data ?? [];

  return (
    <Section title="ספריית תרגילים">
      <div className="card overflow-hidden">
        <button
          className="w-full min-h-12 px-3 flex items-center gap-2 text-right"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">
              <span className="num">{rows.length}</span> תרגילים מחוץ לתכנית
            </p>
            <p className="text-2xs text-fg-dim">
              תרגילים שהוצאו מהתכנית — עם כל ההיסטוריה. אפשר להחזיר או לקשר.
            </p>
          </div>
          <IconChevronDown
            size={18}
            className={cn('shrink-0 text-fg-dim transition-transform duration-150', open && 'rotate-180')}
          />
        </button>

        {open && (
          <div className="border-t border-line-muted bg-ink-950 shadow-field px-2 py-2">
            {rows.length === 0 ? (
              <p className="py-4 text-center text-2xs text-fg-dim">
                הספרייה ריקה. תרגיל שמוציאים מהתכנית מגיע לכאן במקום להימחק.
              </p>
            ) : (
              <ul className="card-flat divide-y divide-line-muted">
                {rows.map(({ exercise: ex, sessions, lastDate }) => (
                  <li key={ex.id} className="px-2 py-2">
                    <div className="flex items-center gap-1">
                      <div className="flex-1 min-w-0">
                        <p className="truncate text-sm font-medium">{ex.name}</p>
                        <p className="truncate text-2xs text-fg-dim">
                          {ex.archivedFrom?.workoutName
                            ? `היה ב${ex.archivedFrom.workoutName.split('—')[0]?.trim()}`
                            : 'ללא אימון'}
                          {ex.archivedFrom?.groupName ? ` · ${ex.archivedFrom.groupName}` : ''}
                          {sessions > 0 && lastDate
                            ? ` · ${sessions} אימונים, אחרון ${formatHebDateShort(lastDate)}`
                            : ' · ללא היסטוריה'}
                        </p>
                      </div>
                      {sessions > 0 && (
                        <Link
                          to={`/workout/exercise/${ex.id}/history`}
                          className="btn-icon text-fg-dim hover:text-info"
                          aria-label={`היסטוריה · ${ex.name}`}
                        >
                          <IconChart size={16} />
                        </Link>
                      )}
                      {sessions === 0 && (
                        <button
                          className="btn-icon text-fg-ghost hover:text-bad"
                          aria-label={`מחק לצמיתות · ${ex.name}`}
                          onClick={async () => {
                            const ok = await confirmDialog({
                              title: `למחוק את "${ex.name}" לצמיתות?`,
                              body: 'אין לו היסטוריה, כך ששום נתון לא יאבד.',
                              destructive: true,
                              confirmLabel: 'מחק',
                            });
                            if (!ok) return;
                            const done = await deleteArchivedExercise(ex.id);
                            if (done) toast.success('נמחק');
                            else toast.error('יש לתרגיל נתונים (גם בטיוטה פתוחה) — הוא נשאר בספרייה.');
                          }}
                        >
                          <IconTrash size={15} />
                        </button>
                      )}
                    </div>
                    <div className="mt-1.5 flex gap-1.5">
                      <button
                        className="btn-subtle flex-1 !min-h-10 text-2xs"
                        disabled={!planId}
                        onClick={() => setPlacing(ex)}
                      >
                        החזר לתכנית
                      </button>
                      {sessions > 0 && (
                        <button
                          className="btn-subtle flex-1 !min-h-10 text-2xs"
                          onClick={() => setLinking(ex)}
                        >
                          קשר היסטוריה לתרגיל אחר
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {placing && (
        <PlaceExerciseModal
          exercise={placing}
          open
          planId={planId}
          onClose={() => setPlacing(null)}
        />
      )}
      {linking && (
        <LinkHistoryModal source={linking} planId={planId} onClose={() => setLinking(null)} />
      )}
    </Section>
  );
}

/**
 * "This old exercise is really that one" — fold an archived exercise's
 * history into another exercise. Nothing is rewritten, and it can be undone
 * from the target's history page.
 */
function LinkHistoryModal({
  source,
  planId,
  onClose,
}: {
  source: Exercise;
  planId: string | null;
  onClose: () => void;
}) {
  const candidates = useLiveQuery(async () => {
    const groups = await db.muscleGroups.toArray();
    const workouts = planId ? await db.workouts.where('planId').equals(planId).toArray() : [];
    const workoutIds = new Set(workouts.map((w) => w.id));
    const groupById = new Map(groups.map((g) => [g.id, g]));
    const all = (await db.exercises.toArray()).filter(
      (e) => e.id !== source.id && e.mergedInto === undefined,
    );
    // Live exercises of this plan first, then the rest of the library.
    const inPlan = all.filter((e) => {
      const g = groupById.get(e.muscleGroupId);
      return isLive(e) && !!g && workoutIds.has(g.workoutId);
    });
    const archived = all.filter((e) => !isLive(e));
    const describe = (e: Exercise) => ({
      name: e.name,
      ...(e.muscles ? { muscles: e.muscles } : {}),
      groupName: groupById.get(e.muscleGroupId)?.name ?? e.archivedFrom?.groupName ?? '',
    });
    const ranked = rankSimilar(describe(source), [...inPlan, ...archived], describe, 0).map((c) => ({
      exercise: c.item,
      score: c.score,
      groupName: describe(c.item).groupName,
      archived: !isLive(c.item),
    }));
    return ranked;
  }, [source.id, planId]);

  return (
    <Modal open onClose={onClose} title="קישור היסטוריה">
      <p className="mb-3 text-xs text-fg-muted leading-relaxed">
        ההיסטוריה של <span className="font-semibold text-fg">{source.name}</span> תוצג ותיספר כחלק
        מהתרגיל שתבחרו (התקדמות, שיאים, הצעת משקל). שום רישום לא משתנה, ואפשר לבטל את הקישור מדף
        ההיסטוריה של התרגיל.
      </p>
      <ul className="card-flat divide-y divide-line-muted max-h-[55vh] overflow-y-auto">
        {(candidates ?? []).map(({ exercise: e, score, groupName, archived }) => (
          <li key={e.id}>
            <button
              className="w-full min-h-12 px-3 py-1.5 text-right hover:bg-ink-800 flex items-center gap-2"
              onClick={async () => {
                const ok = await confirmDialog({
                  title: `לקשר ל"${e.name}"?`,
                  body: `${source.name} ייעלם מהספרייה וההיסטוריה שלו תופיע תחת ${e.name}.`,
                  confirmLabel: 'קשר',
                });
                if (!ok) return;
                await linkHistory(source.id, e.id);
                onClose();
                toast.success(`ההיסטוריה קושרה ל${e.name}`);
              }}
            >
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm">{e.name}</p>
                <p className="truncate text-2xs text-fg-dim">
                  {groupName}
                  {archived ? ' · בספרייה' : ''}
                </p>
              </div>
              {score >= 60 && <span className="chip border-info/25 bg-info/[0.06] text-info">דומה</span>}
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

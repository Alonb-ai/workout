import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { SetRow } from './SetRow';
import { PlateCalcModal } from './PlateCalcModal';
import type { DraftExercise, DraftSet } from './types';
import {
  IconChart,
  IconDots,
  IconPlus,
  IconCalc,
  IconCheck,
  IconClock,
  IconWarn,
} from '@/components/Icon';
import { useTimerStore } from '@/store/timer';
import { useWorkoutSessionStore } from '@/store/workoutSession';
import { Modal } from '@/components/Modal';
import { NumberInput } from '@/components/NumberInput';
import { db } from '@/db/db';

interface Props {
  draft: DraftExercise;
  isStalled?: boolean;
  onChange: (next: DraftExercise) => void;
  onRemove: () => void;
}

export function ExerciseCard({ draft, isStalled, onChange, onRemove }: Props) {
  const [plateOpen, setPlateOpen] = useState(false);
  const [plateWeight, setPlateWeight] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editTargetOpen, setEditTargetOpen] = useState(false);
  const [editBarOpen, setEditBarOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);

  const startTimer = useTimerStore((s) => s.start);
  const setActiveExercise = useWorkoutSessionStore((s) => s.setActiveExercise);

  const completedCount = draft.sets.filter((s) => s.completed).length;

  const updateSet = (index: number, next: DraftSet) => {
    const sets = [...draft.sets];
    sets[index] = next;
    onChange({ ...draft, sets });
  };

  const completeSet = (index: number) => {
    const sets = [...draft.sets];
    const s = sets[index]!;
    const filled = s.weight !== '' && s.reps !== '';
    if (s.completed) {
      // toggle off
      sets[index] = { ...s, completed: false };
    } else if (filled) {
      sets[index] = { ...s, completed: true };
      // Start rest timer
      startTimer(draft.defaultRestSec, draft.exerciseName);
      setActiveExercise(draft.exerciseId);
    }
    onChange({ ...draft, sets });
  };

  const addSet = () => {
    const last = draft.sets[draft.sets.length - 1];
    const next: DraftSet = {
      setNumber: (last?.setNumber ?? 0) + 1,
      weight: '',
      reps: '',
      completed: false,
      ...(last
        ? {
            ghostWeight: last.weight === '' ? last.ghostWeight : Number(last.weight),
            ghostReps: last.reps === '' ? last.ghostReps : Number(last.reps),
          }
        : {}),
    };
    onChange({ ...draft, sets: [...draft.sets, next] });
  };

  const removeSet = (index: number) => {
    if (draft.sets.length <= 1) return;
    const sets = draft.sets.filter((_, i) => i !== index).map((s, i) => ({
      ...s,
      setNumber: i + 1,
    }));
    onChange({ ...draft, sets });
  };

  const incomplete = completedCount < draft.targetSets;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="card overflow-hidden"
    >
      <div className="px-3 py-2.5 flex items-center gap-2 border-b border-line/60">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <h3 className="font-bold truncate">{draft.exerciseName}</h3>
            {isStalled && (
              <span className="chip border-warn/40 text-warn bg-warn-soft" title="תקוע 3 אימונים">
                <IconWarn size={11} /> תקוע
              </span>
            )}
          </div>
          <p className="text-2xs text-fg-muted">
            {draft.muscleGroupName} · {draft.targetSets}×{draft.targetRepsMin}-{draft.targetRepsMax}
            {' '}· מנוחה {Math.round(draft.defaultRestSec / 60)} דק׳
            {draft.isMachine && ' · מכונה'}
          </p>
        </div>
        <span className="num chip border-line text-fg-muted">
          {completedCount}/{draft.targetSets}
        </span>
        <Link
          to={`/workout/exercise/${draft.exerciseId}/history`}
          className="btn-icon !min-w-9 !min-h-9 text-info"
          aria-label="היסטוריה"
        >
          <IconChart size={18} />
        </Link>
        <button
          type="button"
          className="btn-icon !min-w-9 !min-h-9"
          aria-label="פעולות"
          onClick={() => setMenuOpen(true)}
        >
          <IconDots size={18} />
        </button>
      </div>

      <div className="px-2 pt-1 pb-2">
        <div className="grid grid-cols-[1.75rem,1fr,1fr,auto,auto,auto] gap-x-2 px-2 pb-1 text-2xs text-fg-muted">
          <span></span>
          <span className="text-center">משקל (נטו kg)</span>
          <span className="text-center">חזרות</span>
          <span></span>
          <span></span>
          <span></span>
        </div>

        <div className="space-y-1.5">
          {draft.sets.map((s, i) => (
            <SetRow
              key={i}
              set={s}
              index={i}
              canRemove={draft.sets.length > 1}
              onChange={(n) => updateSet(i, n)}
              onComplete={() => completeSet(i)}
              onRemove={() => removeSet(i)}
              onOpenPlate={(w) => {
                setPlateWeight(w);
                setPlateOpen(true);
              }}
            />
          ))}
        </div>

        <div className="flex items-center justify-between mt-2 pt-2 border-t border-line/60">
          <button
            type="button"
            onClick={addSet}
            className="btn-subtle !min-h-9 !px-2 text-xs"
          >
            <IconPlus size={16} /> הוסף סט
          </button>
          <div className="flex items-center gap-2">
            {incomplete && (
              <span className="chip border-warn/40 text-warn bg-warn-soft">
                <IconWarn size={11} /> חסר
              </span>
            )}
            <button
              type="button"
              className="btn-subtle !min-h-9 !px-2 text-xs"
              onClick={() => {
                const w = draft.sets.find((s) => s.weight !== '')?.weight ?? draft.sets[0]?.ghostWeight ?? 0;
                setPlateWeight(typeof w === 'number' ? w : 0);
                setPlateOpen(true);
              }}
            >
              <IconCalc size={16} /> פלטות
            </button>
          </div>
        </div>
      </div>

      <PlateCalcModal
        open={plateOpen}
        onClose={() => setPlateOpen(false)}
        netWeight={plateWeight}
        barWeight={draft.barWeight}
        isMachine={draft.isMachine}
        exerciseName={draft.exerciseName}
      />

      <Modal open={menuOpen} onClose={() => setMenuOpen(false)} title="פעולות תרגיל">
        <ul className="divide-y divide-line">
          <li>
            <button
              className="w-full text-right py-3 px-1 hover:bg-ink-800 rounded-lg"
              onClick={() => {
                setMenuOpen(false);
                setEditTargetOpen(true);
              }}
            >
              עריכת יעד (סטים × חזרות, מנוחה)
            </button>
          </li>
          <li>
            <button
              className="w-full text-right py-3 px-1 hover:bg-ink-800 rounded-lg"
              onClick={() => {
                setMenuOpen(false);
                setEditBarOpen(true);
              }}
            >
              עריכת משקל המוט (לפלטות בלבד)
            </button>
          </li>
          <li>
            <button
              className="w-full text-right py-3 px-1 hover:bg-ink-800 rounded-lg"
              onClick={() => {
                setMenuOpen(false);
                setNotesOpen(true);
              }}
            >
              הערות
            </button>
          </li>
          <li>
            <button
              className="w-full text-right py-3 px-1 hover:bg-ink-800 rounded-lg text-bad"
              onClick={() => {
                setMenuOpen(false);
                onRemove();
              }}
            >
              הסר תרגיל מהאימון
            </button>
          </li>
        </ul>
      </Modal>

      <Modal
        open={editTargetOpen}
        onClose={() => setEditTargetOpen(false)}
        title="עריכת יעד"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setEditTargetOpen(false)}>
              ביטול
            </button>
            <button
              className="btn-primary"
              onClick={async () => {
                // Persist to the source exercise so future sessions use it.
                await db.exercises.update(draft.exerciseId, {
                  targetSets: draft.targetSets,
                  targetRepsMin: draft.targetRepsMin,
                  targetRepsMax: draft.targetRepsMax,
                  defaultRestSec: draft.defaultRestSec,
                  updatedAt: Date.now(),
                });
                setEditTargetOpen(false);
              }}
            >
              שמור
            </button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">סטים</label>
            <NumberInput
              value={draft.targetSets}
              onChange={(v) =>
                onChange({ ...draft, targetSets: v === '' ? 1 : Math.max(1, Number(v)) })
              }
              min={1}
              max={20}
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
                onChange({ ...draft, defaultRestSec: v === '' ? 60 : Math.max(15, Number(v)) })
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
                onChange({ ...draft, targetRepsMin: v === '' ? 1 : Math.max(1, Number(v)) })
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
                onChange({ ...draft, targetRepsMax: v === '' ? 1 : Math.max(1, Number(v)) })
              }
              min={1}
              step={1}
              decimals={0}
              withSteppers
            />
          </div>
        </div>
      </Modal>

      <Modal
        open={editBarOpen}
        onClose={() => setEditBarOpen(false)}
        title="משקל המוט/ידית"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setEditBarOpen(false)}>
              ביטול
            </button>
            <button
              className="btn-primary"
              onClick={async () => {
                await db.exercises.update(draft.exerciseId, {
                  barWeight: draft.barWeight,
                  isMachine: draft.isMachine,
                  updatedAt: Date.now(),
                });
                setEditBarOpen(false);
              }}
            >
              שמור
            </button>
          </>
        }
      >
        <p className="text-xs text-fg-muted mb-3">
          משמש <strong>אך ורק</strong> לחישוב הפלטות. המשקלים הנשמרים תמיד נטו (פלטות בלבד).
        </p>
        <div className="space-y-3">
          <div>
            <label className="label">משקל המוט (kg)</label>
            <NumberInput
              value={draft.barWeight}
              onChange={(v) => onChange({ ...draft, barWeight: v === '' ? 0 : Number(v) })}
              min={0}
              step={2.5}
              decimals={2}
              withSteppers
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="w-5 h-5 accent-orange-500"
              checked={draft.isMachine}
              onChange={(e) => onChange({ ...draft, isMachine: e.target.checked })}
            />
            תרגיל מכונה / סטאק (חישוב פלטות לא רלוונטי)
          </label>
        </div>
      </Modal>

      <Modal
        open={notesOpen}
        onClose={() => setNotesOpen(false)}
        title="הערות"
        footer={
          <button className="btn-primary" onClick={() => setNotesOpen(false)}>
            שמור
          </button>
        }
      >
        <textarea
          className="input min-h-32 text-sm"
          placeholder="הערות לתרגיל (טיפים, צורת ביצוע, וכו׳)…"
          value={draft.notes ?? ''}
          onChange={(e) => onChange({ ...draft, notes: e.target.value })}
        />
      </Modal>

      <AnimatePresence>
        {completedCount === draft.targetSets && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-good-soft border-t border-good/30 px-3 py-2 text-xs text-good font-semibold flex items-center gap-1.5"
          >
            <IconCheck size={14} /> כל הסטים הושלמו · מנוחה
            <IconClock size={14} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

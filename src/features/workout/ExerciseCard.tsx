import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { SetRow } from './SetRow';
import { PlateCalcModal } from './PlateCalcModal';
import type { DraftExercise, DraftSet } from './types';
import type { Prescription, ProgressionKind } from '@/utils/progression';
import {
  IconChart,
  IconDots,
  IconPlus,
  IconCalc,
  IconCheck,
  IconClock,
  IconTarget,
  IconWarn,
} from '@/components/Icon';
import { cn } from '@/utils/cn';
import { formatHM } from '@/utils/dates';
import { useTimerStore } from '@/store/timer';
import { Modal } from '@/components/Modal';
import { confirmDialog } from '@/components/Confirm';
import { NumberInput } from '@/components/NumberInput';
import { db } from '@/db/db';

/**
 * The prescription reads as a marginal note against the exercise, not as a
 * banner across it: an accent rule on the leading edge and a barely-there tint.
 * A solid colour block here out-shouted the exercise name it belonged to.
 */
const PRESCRIPTION_STYLE: Record<ProgressionKind, { rule: string; tint: string; text: string }> = {
  increase: { rule: 'bg-good', tint: 'bg-good/[0.06]', text: 'text-good' },
  'add-rep': { rule: 'bg-accent', tint: 'bg-accent/[0.07]', text: 'text-accent-text' },
  hold: { rule: 'bg-info', tint: 'bg-info/[0.06]', text: 'text-info' },
  deload: { rule: 'bg-warn', tint: 'bg-warn/[0.07]', text: 'text-warn' },
  first: { rule: 'bg-fg-ghost', tint: 'bg-ink-800/50', text: 'text-fg-muted' },
};

const KIND_LABEL: Record<ProgressionKind, string> = {
  increase: 'העלאת משקל',
  'add-rep': 'עוד חזרה',
  hold: 'החזק',
  deload: 'דה-לוד',
  first: 'התחלה',
};

/**
 * Grow or shrink the visible set rows to match a new target, without ever
 * discarding a set the user already logged. New rows inherit the ghost values
 * so the one-tap flow keeps working on them.
 */
function resizeSets(sets: DraftSet[], targetSets: number): DraftSet[] {
  // "Has content" covers typed-but-not-yet-ticked rows too — lowering the
  // target (or just saving the rest time) must never silently swallow numbers
  // the user has already entered.
  const lastUsed = sets.reduce(
    (m, s, i) => (s.completed || s.weight !== '' || s.reps !== '' ? i : m),
    -1,
  );
  const want = Math.max(targetSets, lastUsed + 1);
  if (sets.length === want) return sets;
  if (sets.length > want) return sets.slice(0, want);
  const template = sets[sets.length - 1];
  const extra: DraftSet[] = Array.from({ length: want - sets.length }, (_, i) => ({
    setNumber: sets.length + i + 1,
    weight: '',
    reps: '',
    completed: false,
    ...(template?.ghostWeight !== undefined ? { ghostWeight: template.ghostWeight } : {}),
    ...(template?.ghostReps !== undefined ? { ghostReps: template.ghostReps } : {}),
  }));
  return [...sets, ...extra];
}

/**
 * "What to lift now", with the numbers as the hero rather than a sentence —
 * this is the one thing the user reads between sets, at arm's length, tired.
 */
function PrescriptionStrip({
  prescription,
  lastSummary,
  isMachine,
}: {
  prescription: Prescription;
  lastSummary?: string;
  isMachine: boolean;
}) {
  const style = PRESCRIPTION_STYLE[prescription.kind];
  const delta = prescription.weight - prescription.fromWeight;
  const showDelta = prescription.kind === 'increase' || prescription.kind === 'deload';

  return (
    <div className={cn('relative flex items-center gap-3 px-3 py-2.5', style.tint)}>
      <span className={cn('absolute inset-y-0 start-0 w-[3px]', style.rule)} aria-hidden />

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className={cn('eyebrow', style.text)}>{KIND_LABEL[prescription.kind]}</span>
          {showDelta && delta !== 0 && (
            <span className={cn('num text-2xs font-bold', style.text)}>
              {delta > 0 ? '+' : ''}
              {delta % 1 === 0 ? delta : delta.toFixed(2).replace(/0$/, '')}
            </span>
          )}
        </div>

        {prescription.weight > 0 || prescription.kind !== 'first' ? (
          <p className="mt-0.5 flex items-baseline gap-1.5">
            {prescription.weight > 0 && (
              <>
                <span className="num-display text-xl leading-none">{prescription.weight}</span>
                <span className="text-2xs text-fg-muted">{isMachine ? 'סטאק' : 'ק״ג'}</span>
                <span className="text-fg-ghost">×</span>
              </>
            )}
            <span className="num-display text-xl leading-none">{prescription.reps}</span>
            <span className="text-2xs text-fg-muted">חזרות</span>
          </p>
        ) : (
          <p className="mt-0.5 text-xs text-fg-muted">קבע משקל התחלה</p>
        )}

        {lastSummary && (
          <p className="mt-1 text-2xs text-fg-dim">
            קודם <span className="num">{lastSummary}</span>
          </p>
        )}
      </div>

      <IconTarget size={16} className={cn('shrink-0 opacity-40', style.text)} />
    </div>
  );
}

interface TargetForm {
  targetSets: number;
  targetRepsMin: number;
  targetRepsMax: number;
  defaultRestSec: number;
}

interface LoadForm {
  barWeight: number;
  isMachine: boolean;
  /** '' means "use the automatic step". */
  incrementKg: number | '';
}

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
  // The edit modals work on their own copy of the values and only write back on
  // Save. Editing `draft` live made "ביטול" a lie — the change was already in
  // the session (and already autosaved) by the time the user pressed it.
  const [targetForm, setTargetForm] = useState<TargetForm | null>(null);
  const [loadForm, setLoadForm] = useState<LoadForm | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const [renamePersist, setRenamePersist] = useState(false);

  const startTimer = useTimerStore((s) => s.start);

  const completedCount = draft.sets.filter((s) => s.completed).length;

  const updateSet = (index: number, next: DraftSet) => {
    const sets = [...draft.sets];
    sets[index] = next;
    onChange({ ...draft, sets });
  };

  /**
   * Tapping ✓ on an untouched set adopts the prescribed values shown as ghost
   * text and writes them in as real numbers — the whole point of the
   * prescription is that a normal set costs exactly one tap. Anything the user
   * actually typed always wins over the ghost.
   */
  const completeSet = (index: number) => {
    const sets = [...draft.sets];
    const s = sets[index]!;
    if (s.completed) {
      sets[index] = { ...s, completed: false };
      onChange({ ...draft, sets });
      return;
    }
    const reps = s.reps !== '' ? Number(s.reps) : s.ghostReps;
    if (reps === undefined || reps <= 0) return; // nothing to log yet
    const weight = s.weight !== '' ? Number(s.weight) : (s.ghostWeight ?? 0);
    sets[index] = { ...s, weight, reps, completed: true };
    onChange({ ...draft, sets });
    startTimer(draft.defaultRestSec, draft.exerciseName);
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
    // No `layout` prop: this card re-renders on every keystroke, and layout
    // animation made framer measure and tween all six cards each time — the
    // whole list visibly floated on every tap. A short fade is the only
    // entrance this needs.
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
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
            {' '}· מנוחה {formatHM(draft.defaultRestSec)}
            {draft.isMachine && ' · מכונה'}
          </p>
        </div>
        {/* Turns green the moment the exercise is finished — the card's own
            "done" signal, so the user can scan the list rather than count. */}
        <span
          className={cn(
            'num-display shrink-0 text-sm px-2 py-0.5 rounded-lg',
            completedCount === 0
              ? 'field text-fg-dim'
              : completedCount >= draft.targetSets
                ? 'bg-good-soft text-good'
                : 'field text-accent-text',
          )}
        >
          {completedCount}/{draft.targetSets}
        </span>
        <Link
          to={`/workout/exercise/${draft.exerciseId}/history`}
          className="btn-icon !min-w-9 !min-h-9 text-fg-dim hover:text-info"
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

      {draft.prescription && (
        <PrescriptionStrip
          prescription={draft.prescription}
          lastSummary={draft.lastSummary}
          isMachine={draft.isMachine}
        />
      )}

      <div className="px-2 pt-1 pb-2">
        <div className="flex items-center gap-1.5 px-1.5 pb-1 text-2xs text-fg-muted">
          <span className="w-5 shrink-0" />
          <div className="flex-1 min-w-0 grid grid-cols-2 gap-1.5">
            <span className="text-center">משקל (נטו kg)</span>
            <span className="text-center">חזרות</span>
          </div>
          {/* spacers align with the row's action buttons (calc · ✓ · RPE) */}
          <span className="w-8 shrink-0" />
          <span className="w-9 shrink-0" />
          <span className="w-9 shrink-0" />
        </div>

        <div className="space-y-1.5">
          {draft.sets.map((s, i) => (
            <SetRow
              key={i}
              set={s}
              index={i}
              exerciseName={draft.exerciseName}
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
            {/* Only once he has actually started this lift. Flagging "חסר" on a
                card he has not touched yet is nagging, not information — the
                0/5 counter in the header already says it is untouched. */}
            {incomplete && completedCount > 0 && (
              <span className="chip border-warn/30 text-warn bg-warn/[0.07]">
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
                setRenameDraft(draft.exerciseName);
                setRenamePersist(false);
                setMenuOpen(false);
                setRenameOpen(true);
              }}
            >
              שנה שם תרגיל
            </button>
          </li>
          <li>
            <button
              className="w-full text-right py-3 px-1 hover:bg-ink-800 rounded-lg"
              onClick={() => {
                setMenuOpen(false);
                setTargetForm({
                  targetSets: draft.targetSets,
                  targetRepsMin: draft.targetRepsMin,
                  targetRepsMax: draft.targetRepsMax,
                  defaultRestSec: draft.defaultRestSec,
                });
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
                setLoadForm({
                  barWeight: draft.barWeight,
                  isMachine: draft.isMachine,
                  incrementKg: draft.incrementKg ?? '',
                });
              }}
            >
              מוט וקפיצת משקל
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
              onClick={async () => {
                setMenuOpen(false);
                const ok = await confirmDialog({
                  title: 'להסיר את התרגיל מהאימון?',
                  body: `${draft.exerciseName} יוסר מהאימון הנוכחי בלבד. הוא יישאר בתכנית והסטים שכבר סומנו ייעלמו.`,
                  confirmLabel: 'הסר',
                  cancelLabel: 'ביטול',
                  destructive: true,
                });
                if (ok) onRemove();
              }}
            >
              הסר תרגיל מהאימון
            </button>
          </li>
        </ul>
      </Modal>

      <Modal
        open={targetForm !== null}
        onClose={() => setTargetForm(null)}
        title="עריכת יעד"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setTargetForm(null)}>
              ביטול
            </button>
            <button
              className="btn-primary"
              onClick={async () => {
                if (!targetForm) return;
                // A backwards range is a typo: swap, never discard a number.
                const repsMin = Math.min(targetForm.targetRepsMin, targetForm.targetRepsMax);
                const repsMax = Math.max(targetForm.targetRepsMin, targetForm.targetRepsMax);
                const next = { ...targetForm, targetRepsMin: repsMin, targetRepsMax: repsMax };
                // Persist to the source exercise so future sessions use it.
                await db.exercises.update(draft.exerciseId, { ...next, updatedAt: Date.now() });
                onChange({ ...draft, ...next, sets: resizeSets(draft.sets, next.targetSets) });
                setTargetForm(null);
              }}
            >
              שמור
            </button>
          </>
        }
      >
        {targetForm && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">סטים</label>
              <NumberInput
                value={targetForm.targetSets}
                onChange={(v) =>
                  setTargetForm({ ...targetForm, targetSets: v === '' ? 1 : Math.max(1, Number(v)) })
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
                value={targetForm.defaultRestSec}
                onChange={(v) =>
                  setTargetForm({
                    ...targetForm,
                    defaultRestSec: v === '' ? 60 : Math.max(15, Number(v)),
                  })
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
                value={targetForm.targetRepsMin}
                onChange={(v) =>
                  setTargetForm({
                    ...targetForm,
                    targetRepsMin: v === '' ? 1 : Math.max(1, Number(v)),
                  })
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
                value={targetForm.targetRepsMax}
                onChange={(v) =>
                  setTargetForm({
                    ...targetForm,
                    targetRepsMax: v === '' ? 1 : Math.max(1, Number(v)),
                  })
                }
                min={1}
                step={1}
                decimals={0}
                withSteppers
              />
            </div>
            <p className="col-span-2 text-2xs text-fg-muted">
              היעד קובע מתי האפליקציה מעלה משקל: כל הסטים בקצה העליון של הטווח → עלייה.
            </p>
          </div>
        )}
      </Modal>

      <Modal
        open={loadForm !== null}
        onClose={() => setLoadForm(null)}
        title="מוט וקפיצת משקל"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setLoadForm(null)}>
              ביטול
            </button>
            <button
              className="btn-primary"
              onClick={async () => {
                if (!loadForm) return;
                const incrementKg =
                  loadForm.incrementKg === '' || Number(loadForm.incrementKg) <= 0
                    ? undefined
                    : Number(loadForm.incrementKg);
                await db.exercises.update(draft.exerciseId, {
                  barWeight: loadForm.barWeight,
                  isMachine: loadForm.isMachine,
                  incrementKg,
                  updatedAt: Date.now(),
                });
                onChange({
                  ...draft,
                  barWeight: loadForm.barWeight,
                  isMachine: loadForm.isMachine,
                  ...(incrementKg !== undefined ? { incrementKg } : { incrementKg: undefined }),
                });
                setLoadForm(null);
              }}
            >
              שמור
            </button>
          </>
        }
      >
        {loadForm && (
          <div className="space-y-3">
            <div>
              <label className="label">משקל המוט (kg)</label>
              <NumberInput
                value={loadForm.barWeight}
                onChange={(v) => setLoadForm({ ...loadForm, barWeight: v === '' ? 0 : Number(v) })}
                min={0}
                step={2.5}
                decimals={2}
                withSteppers
              />
              <p className="text-2xs text-fg-muted mt-1">
                משמש <strong>אך ורק</strong> לחישוב הפלטות. המשקלים הנשמרים תמיד נטו.
              </p>
            </div>
            <div>
              <label className="label">קפיצת משקל (kg)</label>
              <NumberInput
                value={loadForm.incrementKg}
                onChange={(v) => setLoadForm({ ...loadForm, incrementKg: v })}
                min={0}
                step={0.25}
                decimals={2}
                withSteppers
                placeholder="אוטומטי"
              />
              <p className="text-2xs text-fg-muted mt-1">
                בכמה לעלות כשהיעד הושג. ריק = אוטומטי (זוג הפלטות הקטן שיש לך, או 2.5 במכונה).
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="w-5 h-5 accent-orange-500"
                checked={loadForm.isMachine}
                onChange={(e) => setLoadForm({ ...loadForm, isMachine: e.target.checked })}
              />
              תרגיל מכונה / סטאק (חישוב פלטות לא רלוונטי)
            </label>
          </div>
        )}
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

      <Modal
        open={renameOpen}
        onClose={() => setRenameOpen(false)}
        title="שינוי שם תרגיל"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setRenameOpen(false)}>
              ביטול
            </button>
            <button
              className="btn-primary"
              onClick={async () => {
                const next = renameDraft.trim();
                if (!next || next === draft.exerciseName) {
                  setRenameOpen(false);
                  return;
                }
                if (renamePersist) {
                  // Update the source exercise → future sessions use the new name.
                  await db.exercises.update(draft.exerciseId, {
                    name: next,
                    updatedAt: Date.now(),
                  });
                }
                // Always update the in-memory draft → reflected immediately and
                // snapshotted onto the session log when saved.
                onChange({ ...draft, exerciseName: next });
                setRenameOpen(false);
              }}
            >
              <IconCheck size={16} /> שמור
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="label">שם חדש</label>
            <input
              className="input"
              autoFocus
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
            />
          </div>
          <label className="flex items-start gap-2 text-sm bg-ink-900 rounded-xl p-3 border border-line cursor-pointer">
            <input
              type="checkbox"
              className="w-5 h-5 accent-orange-500 mt-0.5 shrink-0"
              checked={renamePersist}
              onChange={(e) => setRenamePersist(e.target.checked)}
            />
            <span>
              <span className="font-semibold">החל גם על אימונים הבאים</span>
              <span className="block text-2xs text-fg-muted mt-0.5">
                אם לא תסמן — השם החדש יחול רק על האימון הזה. תרגיל המקור ושמות תרגילים
                באימונים הבאים יישארו ללא שינוי.
              </span>
            </span>
          </label>
          <p className="text-2xs text-fg-muted">
            אימונים שכבר נשמרו לא מושפעים בכל מקרה (שומרים תמיד את השם שהיה בעת השמירה).
          </p>
        </div>
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

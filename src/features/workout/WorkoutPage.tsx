import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import { Section } from '@/components/Section';
import { EmptyState } from '@/components/EmptyState';
import { Modal } from '@/components/Modal';
import {
  IconBarbell,
  IconCalendar,
  IconCheck,
  IconRefresh,
  IconTrophy,
  IconWarn,
} from '@/components/Icon';
import { ExerciseCard } from './ExerciseCard';
import type { DraftExercise } from './types';
import {
  buildDraftFromWorkout,
  applyRepeatLastSession,
  saveSession,
  type SaveResult,
} from './buildSession';
import { todayISO } from '@/utils/dates';
import { format } from 'date-fns';
import { toast } from '@/store/toast';
import { useStallFlags } from '../dashboard/useStallFlags';
import { useTimerStore } from '@/store/timer';
import { motion, AnimatePresence } from 'framer-motion';

interface LocationState {
  workoutId?: string;
}

export function WorkoutPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as LocationState | null;

  const activePlan = useLiveQuery(
    async () =>
      (await db.plans.toArray()).find((p) => p.isActive) ??
      (await db.plans.toArray())[0] ??
      null,
    [],
  );
  const workouts = useLiveQuery(
    async () => {
      if (!activePlan) return [];
      return db.workouts.where('planId').equals(activePlan.id).sortBy('order');
    },
    [activePlan?.id],
  );

  const [selectedWorkoutId, setSelectedWorkoutId] = useState<string | null>(
    state?.workoutId ?? null,
  );

  // initialise selection if none yet
  useEffect(() => {
    if (!selectedWorkoutId && workouts && workouts.length > 0) {
      setSelectedWorkoutId(workouts[0]!.id);
    }
  }, [selectedWorkoutId, workouts]);

  const [drafts, setDrafts] = useState<DraftExercise[]>([]);
  const [sessionDate, setSessionDate] = useState<string>(todayISO());
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [confirmIncompleteOpen, setConfirmIncompleteOpen] = useState(false);
  const [scoreModalOpen, setScoreModalOpen] = useState(false);
  const [saveResult, setSaveResult] = useState<SaveResult | null>(null);
  const startedAtRef = useRef<number>(Date.now());
  const stopTimer = useTimerStore((s) => s.stop);

  const stallFlags = useStallFlags();
  const stalledIds = new Set(stallFlags.map((s) => s.exerciseId));

  useEffect(() => {
    if (!selectedWorkoutId) return;
    setLoading(true);
    startedAtRef.current = Date.now();
    buildDraftFromWorkout(selectedWorkoutId).then((res) => {
      if (res) setDrafts(res.drafts);
      setLoading(false);
    });
  }, [selectedWorkoutId]);

  const completedCount = useMemo(
    () => drafts.reduce((s, d) => s + d.sets.filter((x) => x.completed).length, 0),
    [drafts],
  );
  const plannedCount = useMemo(
    () => drafts.reduce((s, d) => s + d.targetSets, 0),
    [drafts],
  );

  const incomplete = completedCount < plannedCount;

  const onRepeatLast = async () => {
    if (!selectedWorkoutId) return;
    const updated = await applyRepeatLastSession(selectedWorkoutId, drafts);
    const changed = updated.some((u, i) => {
      const d = drafts[i];
      return d && u.sets.some((s, j) => {
        const ds = d.sets[j];
        return !ds || s.weight !== ds.weight || s.reps !== ds.reps;
      });
    });
    setDrafts(updated);
    toast.success(changed ? 'נטענו ערכי האימון הקודם' : 'אין אימון קודם זמין לטעינה');
  };

  const onAttemptSave = () => {
    if (completedCount === 0) {
      toast.warn('לא סומנו סטים — סמנו לפחות סט אחד לפני שמירה.');
      return;
    }
    if (incomplete) {
      setConfirmIncompleteOpen(true);
    } else {
      setSummaryOpen(true);
    }
  };

  const onSave = async () => {
    if (!selectedWorkoutId) return;
    const workout = workouts?.find((w) => w.id === selectedWorkoutId);
    if (!workout) return;
    setConfirmIncompleteOpen(false);
    setSummaryOpen(false);
    setLoading(true);
    try {
      const res = await saveSession({
        workout,
        drafts,
        date: sessionDate,
        startedAt: startedAtRef.current,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      setSaveResult(res);
      setScoreModalOpen(true);
      stopTimer();
    } catch (e) {
      console.error(e);
      toast.error('שמירת האימון נכשלה. נסו שוב.');
    } finally {
      setLoading(false);
    }
  };

  if (!activePlan || (workouts && workouts.length === 0)) {
    return (
      <div className="pt-6">
        <EmptyState
          title="אין אימונים בתכנית"
          description="בנו תכנית עם אימונים כדי להתחיל לתעד."
          icon={<IconBarbell size={24} />}
          action={
            <button onClick={() => navigate('/plan')} className="btn-primary">
              עבור לתכנית
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div className="pt-3">
      <header className="mb-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-2xs uppercase tracking-wider text-fg-muted">תיעוד אימון</p>
          <div className="flex items-center gap-2">
            <input
              type="date"
              className="bg-transparent text-sm font-semibold text-fg border-b border-dashed border-fg-ghost focus:border-accent outline-none px-1"
              value={sessionDate}
              onChange={(e) => setSessionDate(e.target.value)}
              aria-label="תאריך האימון"
              max={format(new Date(), 'yyyy-MM-dd')}
            />
            <IconCalendar size={14} className="text-fg-muted" />
          </div>
        </div>
        <button
          className="btn-ghost !min-h-9 !px-2 text-xs"
          onClick={onRepeatLast}
          disabled={loading}
        >
          <IconRefresh size={14} /> חזרה על האחרון
        </button>
      </header>

      {/* Workout tabs */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar mb-3 pb-1 -mx-1 px-1">
        {(workouts ?? []).map((w) => (
          <button
            key={w.id}
            onClick={() => setSelectedWorkoutId(w.id)}
            data-active={w.id === selectedWorkoutId}
            className="pill-tab"
          >
            {w.code}
            <span className="hidden sm:inline"> · {w.name.split('—')[0]?.trim()}</span>
          </button>
        ))}
      </div>

      {/* progress bar */}
      <div className="card-flat px-3 py-2 mb-3 flex items-center justify-between">
        <div>
          <p className="text-2xs text-fg-muted">התקדמות אימון</p>
          <p className="num text-sm font-bold">
            {completedCount} / {plannedCount} סטים
          </p>
        </div>
        <div className="flex-1 mx-3 h-1.5 bg-ink-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-accent transition-[width] duration-300"
            style={{
              width: `${plannedCount === 0 ? 0 : (completedCount / plannedCount) * 100}%`,
            }}
          />
        </div>
        <button className="btn-primary !min-h-9 !px-3 text-xs" onClick={onAttemptSave}>
          <IconCheck size={14} /> סיים ושמור
        </button>
      </div>

      {loading && drafts.length === 0 ? (
        <div className="card p-6 text-center text-fg-muted">טוען אימון…</div>
      ) : (
        <Section noPad>
          <div className="space-y-3">
            <AnimatePresence>
              {drafts.map((d) => (
                <ExerciseCard
                  key={d.exerciseId}
                  draft={d}
                  isStalled={stalledIds.has(d.exerciseId)}
                  onChange={(next) =>
                    setDrafts((cur) =>
                      cur.map((c) => (c.exerciseId === next.exerciseId ? next : c)),
                    )
                  }
                  onRemove={() =>
                    setDrafts((cur) => cur.filter((c) => c.exerciseId !== d.exerciseId))
                  }
                />
              ))}
            </AnimatePresence>
          </div>
        </Section>
      )}

      <div className="mt-4">
        <label className="label">הערות לאימון</label>
        <textarea
          className="input min-h-20 text-sm"
          placeholder="איך הרגשת? מה לזכור לאימון הבא?"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      {/* Pre-save: summary modal */}
      <Modal
        open={summaryOpen}
        onClose={() => setSummaryOpen(false)}
        title="סיכום לפני שמירה"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setSummaryOpen(false)}>
              חזור לעריכה
            </button>
            <button className="btn-primary" onClick={onSave}>
              <IconCheck size={16} /> שמור אימון
            </button>
          </>
        }
      >
        <SummaryBody drafts={drafts} completed={completedCount} planned={plannedCount} />
      </Modal>

      {/* Pre-save: incomplete warning */}
      <Modal
        open={confirmIncompleteOpen}
        onClose={() => setConfirmIncompleteOpen(false)}
        title="חסרים סטים"
        footer={
          <>
            <button
              className="btn-ghost"
              onClick={() => setConfirmIncompleteOpen(false)}
            >
              חזור לעריכה
            </button>
            <button className="btn-primary" onClick={() => {
              setConfirmIncompleteOpen(false);
              setSummaryOpen(true);
            }}>
              שמור בכל זאת
            </button>
          </>
        }
      >
        <div className="space-y-2">
          <div className="flex items-start gap-2 text-warn">
            <IconWarn />
            <p className="text-sm">
              שמת לב? סומנו <strong>{completedCount}</strong> מתוך{' '}
              <strong>{plannedCount}</strong> הסטים המתוכננים. ניתן לשמור גם ככה — הנתונים לא יאבדו.
            </p>
          </div>
          <ul className="text-xs text-fg-muted space-y-1 mt-2">
            {drafts
              .filter((d) => d.sets.filter((s) => s.completed).length < d.targetSets)
              .map((d) => (
                <li key={d.exerciseId} className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-warn" />
                  {d.exerciseName}: {d.sets.filter((s) => s.completed).length}/{d.targetSets}
                </li>
              ))}
          </ul>
        </div>
      </Modal>

      {/* Post-save: score modal */}
      <Modal
        open={scoreModalOpen}
        onClose={() => {
          setScoreModalOpen(false);
          setSaveResult(null);
          setNotes('');
          // refresh drafts so ghost values reflect the just-saved session
          if (selectedWorkoutId) {
            buildDraftFromWorkout(selectedWorkoutId).then((res) => {
              if (res) setDrafts(res.drafts);
            });
          }
          navigate('/progress');
        }}
        title="האימון נשמר 🎉"
        footer={
          <button
            className="btn-primary"
            onClick={() => {
              setScoreModalOpen(false);
              setSaveResult(null);
              navigate('/progress');
            }}
          >
            עבור להתקדמות
          </button>
        }
      >
        {saveResult && (
          <div className="text-center py-2">
            <motion.div
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 220, damping: 18 }}
              className="mx-auto w-28 h-28 rounded-full border-4 border-accent flex items-center justify-center mb-3 shadow-glow"
            >
              <div className="text-center">
                <p className="text-2xs text-fg-muted">ציון</p>
                <p className="num text-4xl font-extrabold">{saveResult.score}</p>
              </div>
            </motion.div>
            <p className="text-sm text-fg-muted">{saveResult.message}</p>
            {saveResult.prCount > 0 && (
              <div className="mt-3 inline-flex items-center gap-1.5 chip border-warn/40 text-warn bg-warn-soft">
                <IconTrophy size={12} /> {saveResult.prCount} שיאים חדשים
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

function SummaryBody({
  drafts,
  completed,
  planned,
}: {
  drafts: DraftExercise[];
  completed: number;
  planned: number;
}) {
  const totalVol = drafts.reduce(
    (s, d) =>
      s +
      d.sets.reduce(
        (ss, x) =>
          ss + (x.completed ? Number(x.weight || 0) * Number(x.reps || 0) : 0),
        0,
      ),
    0,
  );
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <Mini label="סטים" value={`${completed}/${planned}`} />
        <Mini label="תרגילים" value={String(drafts.length)} />
        <Mini label="נפח" value={`${totalVol.toLocaleString('he-IL')}kg`} />
      </div>
      <div className="card-flat p-2 max-h-56 overflow-y-auto">
        <ul className="text-xs space-y-1.5">
          {drafts.map((d) => {
            const done = d.sets.filter((s) => s.completed).length;
            return (
              <li
                key={d.exerciseId}
                className="flex items-center justify-between gap-2"
              >
                <span className="truncate">{d.exerciseName}</span>
                <span
                  className={`num text-2xs ${
                    done === d.targetSets ? 'text-good' : 'text-fg-muted'
                  }`}
                >
                  {done}/{d.targetSets}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
      <p className="text-2xs text-fg-muted text-center">
        כל המשקלים נשמרים נטו (פלטות בלבד, ללא משקל המוט).
      </p>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="card-flat p-2 text-center">
      <p className="text-2xs text-fg-muted">{label}</p>
      <p className="num text-base font-bold">{value}</p>
    </div>
  );
}

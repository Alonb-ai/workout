import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import { Section } from '@/components/Section';
import { EmptyState } from '@/components/EmptyState';
import { Modal } from '@/components/Modal';
import {
  IconBarbell,
  IconCheck,
  IconPlus,
  IconTrash,
  IconTrophy,
  IconWarn,
} from '@/components/Icon';
import { ExerciseCard } from './ExerciseCard';
import { AddExerciseModal } from './AddExerciseModal';
import type { DraftExercise } from './types';
import {
  buildDraftFromWorkout,
  reconcileDraftWithPlan,
  saveSession,
  type SaveResult,
} from './buildSession';
import { ensureFreestyleWorkout, getWorkoutDraft } from '@/db/queries';
import { todayISO } from '@/utils/dates';
import { format } from 'date-fns';
import { toast } from '@/store/toast';
import { confirmDialog } from '@/components/Confirm';
import { useStallFlags } from '../dashboard/useStallFlags';
import { useTimerStore } from '@/store/timer';
import { motion, AnimatePresence } from 'framer-motion';

/** Has the user typed/marked anything meaningful that's worth persisting? */
function isDraftDirty(drafts: DraftExercise[], notes: string): boolean {
  if (notes.trim().length > 0) return true;
  return drafts.some((d) =>
    d.sets.some(
      (s) =>
        s.completed ||
        s.weight !== '' ||
        s.reps !== '' ||
        (s.rpe !== undefined && s.rpe !== ''),
    ),
  );
}

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

  // Resolved by id, NOT by searching the active plan's list. A draft can belong
  // to a workout the user has since moved to another plan; looking it up in the
  // active plan returned undefined, and both the autosave and Finish & Save
  // then silently did nothing while the banner still said "saved".
  const selectedWorkout = useLiveQuery(
    async () => (selectedWorkoutId ? ((await db.workouts.get(selectedWorkoutId)) ?? null) : null),
    [selectedWorkoutId],
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
  const [addExerciseOpen, setAddExerciseOpen] = useState(false);
  const [scoreModalOpen, setScoreModalOpen] = useState(false);
  const [saveResult, setSaveResult] = useState<SaveResult | null>(null);
  const [restoredFromDraft, setRestoredFromDraft] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const startedAtRef = useRef<number>(Date.now());
  // Hardens against an in-flight autosave timer (already fired but mid-await)
  // overwriting the just-saved/discarded draft. When true, the autosave
  // callback bails before touching the DB.
  const savingRef = useRef(false);
  const stopTimer = useTimerStore((s) => s.stop);

  const stallFlags = useStallFlags();
  const stalledIds = new Set(stallFlags.map((s) => s.exerciseId));

  useEffect(() => {
    if (!selectedWorkoutId) return;
    setLoading(true);
    setRestoredFromDraft(false);
    setLastSavedAt(null);
    // Building a draft runs a history query per exercise, so two rapid tab
    // switches overlap. Without this guard the slower run still called
    // setDrafts and wrote workout A's sets into workout B's editor.
    let cancelled = false;
    (async () => {
      const existing = await getWorkoutDraft(selectedWorkoutId);
      if (cancelled) return;
      if (existing) {
        // The draft is a snapshot; the plan may have moved on since. Refresh
        // names/targets and pick up newly added exercises, without touching a
        // single logged set.
        const reconciled = await reconcileDraftWithPlan(selectedWorkoutId, existing.drafts);
        if (cancelled) return;
        setDrafts(reconciled);
        setSessionDate(existing.sessionDate);
        setNotes(existing.notes);
        startedAtRef.current = existing.startedAt;
        setRestoredFromDraft(true);
        setLastSavedAt(existing.updatedAt);
      } else {
        const res = await buildDraftFromWorkout(selectedWorkoutId);
        if (cancelled) return;
        startedAtRef.current = Date.now();
        setSessionDate(todayISO());
        setNotes('');
        if (res) setDrafts(res.drafts);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedWorkoutId]);

  // The single writer of the draft row. Called on a 500 ms debounce while
  // typing, and again immediately whenever the app is backgrounded or the
  // screen is left.
  //
  // It takes the workout id and the editor snapshot as EXPLICIT arguments
  // rather than reading them from a closure: on a workout-tab switch the id
  // changes one render before the new drafts finish loading, and a closure that
  // paired the new id with the old drafts would write one workout's sets under
  // another workout's key. `latest` just mirrors current state for the callers.
  const latest = useRef({ drafts, notes, sessionDate });
  latest.current = { drafts, notes, sessionDate };

  type DraftSnapshot = { drafts: DraftExercise[]; notes: string; sessionDate: string };

  const persistDraft = useCallback(
    async (id: string, snap: DraftSnapshot, startedAt: number) => {
      if (savingRef.current) return;
      const workout = id === selectedWorkout?.id ? selectedWorkout : await db.workouts.get(id);
      if (!workout) return;
      if (isDraftDirty(snap.drafts, snap.notes)) {
        const updatedAt = Date.now();
        await db.workoutDrafts.put({
          workoutId: id,
          planId: workout.planId,
          workoutName: workout.name,
          workoutCode: workout.code,
          drafts: snap.drafts,
          sessionDate: snap.sessionDate,
          notes: snap.notes,
          startedAt,
          updatedAt,
        });
        if (!savingRef.current) setLastSavedAt(updatedAt);
      } else if (await db.workoutDrafts.get(id)) {
        if (savingRef.current) return;
        await db.workoutDrafts.delete(id);
        setLastSavedAt(null);
      }
    },
    [selectedWorkout],
  );

  // Debounced autosave for typing. Skipped while the initial draft is loading
  // (would churn an identical write) and while the post-save score modal is up —
  // the in-memory drafts still hold completed sets but the session is already
  // committed, and re-creating the draft there is what produced the old
  // "ghost draft" bug.
  useEffect(() => {
    if (!selectedWorkoutId || loading || saveResult) return;
    const id = selectedWorkoutId;
    const timer = window.setTimeout(
      () => void persistDraft(id, latest.current, startedAtRef.current),
      500,
    );
    return () => window.clearTimeout(timer);
  }, [drafts, notes, sessionDate, selectedWorkoutId, loading, saveResult, persistDraft]);

  // Ticking or un-ticking a set bypasses the debounce entirely. It is a
  // discrete, deliberate action and it is the only thing in the editor that
  // represents work actually done — a reload or an OS tab-discard in the 500 ms
  // that followed the tap used to lose it, because the flush on pagehide is an
  // async IndexedDB write that cannot finish during document teardown.
  const completedCount = useMemo(
    () => drafts.reduce((s, d) => s + d.sets.filter((x) => x.completed).length, 0),
    [drafts],
  );
  const lastPersistedCompleted = useRef(completedCount);
  useEffect(() => {
    if (!selectedWorkoutId || loading || saveResult) return;
    if (lastPersistedCompleted.current === completedCount) return;
    lastPersistedCompleted.current = completedCount;
    void persistDraft(selectedWorkoutId, latest.current, startedAtRef.current);
  }, [completedCount, selectedWorkoutId, loading, saveResult, persistDraft]);

  // Flush immediately when the app is backgrounded or the screen is left. iOS
  // can freeze or discard a PWA tab the moment it loses the foreground, so a
  // pending 500 ms debounce is not a safe place for the user's last set to sit.
  // `visibilitychange` is the event iOS Safari fires reliably; `pagehide`
  // covers tab close and the back/forward cache. Writes are idempotent, so
  // firing on several of them costs nothing. Note the deps deliberately exclude
  // `loading`/`saveResult`: the cleanup must run only when the workout actually
  // changes or the screen unmounts, and it persists the id + snapshot captured
  // here, which are always a matching pair.
  useEffect(() => {
    const id = selectedWorkoutId;
    if (!id) return;
    const flushNow = () => void persistDraft(id, latest.current, startedAtRef.current);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushNow();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flushNow);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flushNow);
      flushNow();
    };
  }, [selectedWorkoutId, persistDraft]);

  const plannedCount = useMemo(
    () => drafts.reduce((s, d) => s + d.targetSets, 0),
    [drafts],
  );

  // Per exercise, not on the totals: extra sets on one lift used to mask an
  // exercise that was never logged at all, so the "missing sets" warning never
  // appeared for exactly the case it exists to catch.
  const incomplete = useMemo(
    () => drafts.some((d) => d.sets.filter((s) => s.completed).length < d.targetSets),
    [drafts],
  );

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
    const workout = selectedWorkout ?? (await db.workouts.get(selectedWorkoutId));
    if (!workout) {
      // Don't leave the summary modal sitting there with nothing happening.
      setSummaryOpen(false);
      setConfirmIncompleteOpen(false);
      toast.error('האימון הזה נמחק מהתכנית — לא ניתן לשמור אותו.');
      return;
    }
    setConfirmIncompleteOpen(false);
    setSummaryOpen(false);
    setLoading(true);
    savingRef.current = true;
    try {
      const res = await saveSession({
        workout,
        drafts,
        date: sessionDate,
        startedAt: startedAtRef.current,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      // Wipe the autosaved draft now that the session is committed. Reset the
      // in-memory state immediately so the autosave effect — which resumes
      // when the score modal closes (saveResult goes back to null) — sees a
      // clean draft and doesn't re-create the row we just deleted.
      await db.workoutDrafts.delete(selectedWorkoutId);
      setRestoredFromDraft(false);
      setLastSavedAt(null);
      setNotes('');
      setSessionDate(todayISO());
      startedAtRef.current = Date.now();
      const fresh = await buildDraftFromWorkout(selectedWorkoutId);
      if (fresh) setDrafts(fresh.drafts);
      setSaveResult(res);
      setScoreModalOpen(true);
      stopTimer();
    } catch (e) {
      console.error(e);
      // Must be cleared here too: the only other reset lives in the score-modal
      // close handlers, which never run on this path — leaving savingRef true
      // silently killed the autosave for the rest of the session.
      savingRef.current = false;
      toast.error('שמירת האימון נכשלה. נסו שוב.');
    } finally {
      setLoading(false);
    }
  };

  const onDiscardDraft = async () => {
    if (!selectedWorkoutId) return;
    const ok = await confirmDialog({
      title: 'להתחיל מחדש?',
      body: 'הטיוטה הנוכחית תימחק וערכי האימון יחזרו למצב התחלתי. אין דרך לשחזר.',
      confirmLabel: 'התחל מחדש',
      cancelLabel: 'חזור',
      destructive: true,
    });
    if (!ok) return;
    setLoading(true);
    savingRef.current = true;
    await db.workoutDrafts.delete(selectedWorkoutId);
    setRestoredFromDraft(false);
    setLastSavedAt(null);
    setNotes('');
    setSessionDate(todayISO());
    startedAtRef.current = Date.now();
    const res = await buildDraftFromWorkout(selectedWorkoutId);
    if (res) setDrafts(res.drafts);
    savingRef.current = false;
    setLoading(false);
    toast.info('הטיוטה נמחקה — אפשר להתחיל מחדש.');
  };

  // `undefined` means the live query hasn't resolved yet — showing "no workouts
  // in plan" during that window told the user his program was gone.
  if (activePlan === undefined || workouts === undefined) {
    return <div className="card p-6 text-center text-fg-muted mt-6">טוען…</div>;
  }

  if (!activePlan || workouts.length === 0) {
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
      <header className="mb-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">תיעוד אימון</p>
          <h1 className="text-xl font-extrabold truncate mt-0.5">
            {selectedWorkout?.name.split('—')[0]?.trim() ?? 'אימון'}
          </h1>
        </div>
        {/* A real field, not a dashed underline. The native picker stays — it is
            better than anything we would build, and it is the OS the user knows. */}
        {/* The native picker indicator IS the calendar icon (tinted to the
            accent in index.css) — a second one of our own was just clutter. */}
        <label className="field shrink-0 flex items-center px-2.5 h-10 focus-within:border-accent/70">
          <input
            type="date"
            className="bg-transparent num text-xs font-semibold text-fg outline-none w-[7.5rem]"
            value={sessionDate}
            onChange={(e) => setSessionDate(e.target.value)}
            aria-label="תאריך האימון"
            max={format(new Date(), 'yyyy-MM-dd')}
          />
        </label>
      </header>

      {/* Workout tabs — a segmented control on one recessed track, so the strip
          reads as a single switch instead of four loose buttons. */}
      <div className="seg w-full mb-3 overflow-x-auto no-scrollbar">
        {workouts
          .filter((w) => !w.isFreestyle)
          .map((w) => (
            <button
              key={w.id}
              onClick={() => setSelectedWorkoutId(w.id)}
              data-active={w.id === selectedWorkoutId}
              className="pill-tab flex-1 !px-2"
              title={w.name}
            >
              {w.code}
            </button>
          ))}
        {/* Off-plan training. The workout row is created on the first tap, so a
            user who never trains freestyle never gets one in his plan. */}
        <button
          onClick={async () => {
            const fs = await ensureFreestyleWorkout(activePlan.id);
            setSelectedWorkoutId(fs.id);
          }}
          data-active={selectedWorkout?.isFreestyle === true}
          className="pill-tab flex-1 !px-2"
          title="אימון חופשי — מתחיל ריק, מוסיפים תרגילים תוך כדי"
        >
          חופשי
        </button>
      </div>

      {/* Autosave / draft banner */}
      {lastSavedAt !== null && (
        <div className="card-flat px-3 py-1.5 mb-3 flex items-center justify-between gap-2 border-accent/30 bg-accent-soft/40">
          <div className="min-w-0 flex items-center gap-2 text-xs">
            <span className="w-2 h-2 rounded-full bg-accent shrink-0" />
            <span className="text-fg-muted truncate">
              {restoredFromDraft ? 'המשך טיוטה' : 'טיוטה נשמרה'} ·{' '}
              <span className="num">{format(new Date(lastSavedAt), 'HH:mm')}</span>
            </span>
          </div>
          <button
            type="button"
            className="btn-ghost !min-h-8 !px-2 text-2xs text-bad/90 hover:text-bad"
            onClick={onDiscardDraft}
            disabled={loading}
            aria-label="התחל מחדש"
          >
            <IconTrash size={12} /> התחל מחדש
          </button>
        </div>
      )}

      {/* Progress + finish. Two rows rather than three things elbowing each
          other in one: the count and the action on top, the bar spanning the
          full width beneath it where it can actually be read at a glance. */}
      <div className="card px-3 py-2.5 mb-3 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow">התקדמות אימון</p>
            <p className="num-display text-lg leading-tight mt-0.5">
              {completedCount} / {plannedCount} סטים
            </p>
          </div>
          <button className="btn-primary !min-h-10 !px-3.5 text-xs shrink-0" onClick={onAttemptSave}>
            <IconCheck size={15} /> סיים ושמור
          </button>
        </div>
        <div className="h-1.5 rounded-full bg-ink-950 overflow-hidden shadow-field">
          <div
            className="h-full rounded-full bg-gradient-to-l from-accent to-accent-hover transition-[width] duration-500 ease-out"
            style={{
              width: `${plannedCount === 0 ? 0 : (completedCount / plannedCount) * 100}%`,
            }}
          />
        </div>
      </div>

      {/* Show the loader whenever we're loading — also when switching between
          workout tabs — so the previous workout's drafts don't flash in until
          the new ones come in. */}
      {loading ? (
        <div className="card p-6 text-center text-fg-muted">טוען אימון…</div>
      ) : (
        <Section>
          <div className="space-y-3">
            {selectedWorkout?.isFreestyle && drafts.length === 0 && (
              <p className="text-center text-xs text-fg-dim px-6 py-4">
                אימון חופשי מתחיל ריק. הוסף תרגילים תוך כדי — כל תרגיל שכבר קיים בתכנית
                שומר על ההיסטוריה וההתקדמות שלו.
              </p>
            )}
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
            <button
              type="button"
              onClick={() => setAddExerciseOpen(true)}
              className="w-full card-flat border-dashed py-3 text-sm font-semibold text-fg-muted hover:text-accent hover:border-accent transition-colors flex items-center justify-center gap-1.5"
            >
              <IconPlus size={16} /> הוסף תרגיל לאימון
            </button>
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

      {/* Add exercise to active session */}
      {selectedWorkoutId && (
        <AddExerciseModal
          open={addExerciseOpen}
          onClose={() => setAddExerciseOpen(false)}
          workoutId={selectedWorkoutId}
          existingDraftExerciseIds={new Set(drafts.map((d) => d.exerciseId))}
          onAdd={(newDraft) => {
            // Append to the end so the new exercise shows up after the existing list.
            setDrafts((cur) => [...cur, { ...newDraft, order: cur.length }]);
          }}
        />
      )}

      {/* Post-save: score modal — state was already reset in onSave, so we
          only flip the modal flags and navigate away. */}
      <Modal
        open={scoreModalOpen}
        onClose={() => {
          setScoreModalOpen(false);
          setSaveResult(null);
          savingRef.current = false;
          navigate('/progress');
        }}
        title="האימון נשמר 🎉"
        footer={
          <button
            className="btn-primary"
            onClick={() => {
              setScoreModalOpen(false);
              setSaveResult(null);
              savingRef.current = false;
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

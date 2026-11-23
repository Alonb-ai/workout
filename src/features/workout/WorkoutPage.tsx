import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, newId } from '@/db/db';
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
  IconSort,
  IconChevronDown,
} from '@/components/Icon';
import { cn } from '@/utils/cn';
import { ExerciseCard, doneWorkSets } from './ExerciseCard';
import { AddExerciseModal } from './AddExerciseModal';
import { SwapExerciseModal } from './SwapExerciseModal';
import { ReorderExercisesModal } from './ReorderExercisesModal';
import { stepDraft } from './reorder';
import { archiveExercises } from '@/db/exerciseLibrary';
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
import { WorkoutDock } from './WorkoutDock';
import { motion, AnimatePresence } from 'framer-motion';

/** Has the user typed/marked anything meaningful that's worth persisting? */
function isDraftDirty(
  drafts: DraftExercise[],
  notes: string,
  removedIds: string[] = [],
  reordered = false,
): boolean {
  if (notes.trim().length > 0) return true;
  // A chosen exercise order is worth keeping across a reload too.
  if (reordered) return true;
  // Taking a plan exercise out of today's session is a choice worth keeping
  // across a reload — otherwise it would silently come back.
  if (removedIds.length > 0) return true;
  if (drafts.some((d) => (d.sessionNote ?? '').trim().length > 0)) return true;
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

/**
 * Neighbouring exercises that share a superset id form one run. Membership is
 * by adjacency, so an exercise moved away from its partner simply stops being
 * part of the superset instead of dragging rest-timer rules along with it.
 */
function supersetRuns(drafts: DraftExercise[]): DraftExercise[][] {
  const runs: DraftExercise[][] = [];
  for (const d of drafts) {
    const last = runs[runs.length - 1];
    if (d.supersetGroup && last && last[0]!.supersetGroup === d.supersetGroup) last.push(d);
    else runs.push([d]);
  }
  return runs;
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
  const [swapTarget, setSwapTarget] = useState<DraftExercise | null>(null);
  // Plan exercises taken out of this session only (removed / swapped away).
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  // Exercise order changed in this session (session-only; plan untouched).
  const [reordered, setReordered] = useState(false);
  const [reorderOpen, setReorderOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
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

  /**
   * Join two neighbouring exercises into one superset. Written to the
   * exercises too, so the pairing comes back next time. If the lower one was
   * already in another superset, that whole superset joins this one.
   */
  const linkSuperset = async (a: DraftExercise, b: DraftExercise) => {
    const group = a.supersetGroup ?? b.supersetGroup ?? newId();
    const absorb = b.supersetGroup && b.supersetGroup !== group ? b.supersetGroup : null;
    const ids = drafts
      .filter(
        (d) =>
          d.exerciseId === a.exerciseId ||
          d.exerciseId === b.exerciseId ||
          (absorb !== null && d.supersetGroup === absorb),
      )
      .map((d) => d.exerciseId);
    setDrafts((cur) =>
      cur.map((d) => (ids.includes(d.exerciseId) ? { ...d, supersetGroup: group } : d)),
    );
    await Promise.all(
      ids.map((id) => db.exercises.update(id, { supersetGroup: group, updatedAt: Date.now() })),
    );
  };

  const moveOne = (exerciseId: string, dir: -1 | 1) => {
    setDrafts((cur) => stepDraft(cur, exerciseId, dir));
    setReordered(true);
  };

  const unlinkSuperset = async (d: DraftExercise) => {
    setDrafts((cur) =>
      cur.map((c) => {
        if (c.exerciseId !== d.exerciseId) return c;
        const { supersetGroup: _g, ...rest } = c;
        void _g;
        return rest;
      }),
    );
    await db.exercises.update(d.exerciseId, { supersetGroup: undefined, updatedAt: Date.now() });
  };

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
        const removed = existing.removedExerciseIds ?? [];
        const reconciled = await reconcileDraftWithPlan(
          selectedWorkoutId,
          existing.drafts,
          removed,
        );
        if (cancelled) return;
        const had = new Set(existing.drafts.map((d) => d.exerciseId));
        const added = reconciled.filter((d) => !had.has(d.exerciseId));
        if (added.length > 0) {
          toast.info(`נוסף מהתכנית: ${added.map((d) => d.exerciseName).join(', ')}`);
        }
        setDrafts(reconciled);
        setRemovedIds(removed);
        setReordered(!!existing.reordered);
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
        setRemovedIds([]);
        setReordered(false);
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
  const latest = useRef({ drafts, notes, sessionDate, removedIds, reordered });
  latest.current = { drafts, notes, sessionDate, removedIds, reordered };

  type DraftSnapshot = {
    drafts: DraftExercise[];
    notes: string;
    sessionDate: string;
    removedIds: string[];
    reordered: boolean;
  };

  const persistDraft = useCallback(
    async (id: string, snap: DraftSnapshot, startedAt: number) => {
      if (savingRef.current) return;
      const workout = id === selectedWorkout?.id ? selectedWorkout : await db.workouts.get(id);
      if (!workout) return;
      if (isDraftDirty(snap.drafts, snap.notes, snap.removedIds, snap.reordered)) {
        const updatedAt = Date.now();
        await db.workoutDrafts.put({
          workoutId: id,
          planId: workout.planId,
          workoutName: workout.name,
          workoutCode: workout.code,
          drafts: snap.drafts,
          sessionDate: snap.sessionDate,
          notes: snap.notes,
          ...(snap.removedIds.length > 0 ? { removedExerciseIds: snap.removedIds } : {}),
          ...(snap.reordered ? { reordered: true } : {}),
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
  }, [drafts, notes, sessionDate, removedIds, reordered, selectedWorkoutId, loading, saveResult, persistDraft]);

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
    () => drafts.some((d) => doneWorkSets(d) < d.targetSets),
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
      setRemovedIds([]);
      setReordered(false);
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
    setRemovedIds([]);
    setReordered(false);
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
      {/* One compact row: what you are training, when, and a way to switch.
          The A/B/C/D strip used to take a full row above the first set; it is
          picked once per session, so it lives one tap away in a sheet. */}
      <header className="mb-3 flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="eyebrow">תיעוד אימון</p>
          <h1 className="text-xl font-extrabold truncate mt-0.5">
            {selectedWorkout?.name.split('—')[0]?.trim() ?? 'אימון'}
          </h1>
        </div>
        {/* The native picker stays — it is better than anything we would build,
            and it is the OS the user knows. Its indicator is tinted in index.css. */}
        <label className="field shrink-0 flex items-center px-2 h-11 focus-within:border-accent/70">
          <input
            type="date"
            className="bg-transparent num text-xs font-semibold text-fg outline-none w-[6.9rem]"
            value={sessionDate}
            onChange={(e) => setSessionDate(e.target.value)}
            aria-label="תאריך האימון"
            max={format(new Date(), 'yyyy-MM-dd')}
          />
        </label>
        <button
          type="button"
          className="btn-ghost shrink-0 !min-h-11 !px-3 text-sm font-bold"
          onClick={() => setPickerOpen(true)}
          aria-label="החלף אימון"
        >
          <span className="num text-accent-text">
            {selectedWorkout?.isFreestyle ? 'חופשי' : (selectedWorkout?.code ?? '—')}
          </span>
          <IconChevronDown size={14} className="text-fg-dim" />
        </button>
      </header>

      <Modal open={pickerOpen} onClose={() => setPickerOpen(false)} title="בחר אימון">
        <ul className="space-y-2">
          {workouts
            .filter((w) => !w.isFreestyle)
            .map((w) => (
              <li key={w.id}>
                <button
                  type="button"
                  aria-label={w.code}
                  data-active={w.id === selectedWorkoutId}
                  className={cn(
                    'card-flat w-full min-h-14 px-3 flex items-center gap-3 text-right',
                    w.id === selectedWorkoutId && 'border-accent/60 bg-accent-soft/40',
                  )}
                  onClick={() => {
                    setSelectedWorkoutId(w.id);
                    setPickerOpen(false);
                  }}
                >
                  <span className="num-display text-lg text-accent-text w-10 shrink-0 text-center">
                    {w.code}
                  </span>
                  <span className="flex-1 min-w-0 text-sm font-semibold truncate">{w.name}</span>
                  {w.id === selectedWorkoutId && <IconCheck size={16} className="text-accent-text shrink-0" />}
                </button>
              </li>
            ))}
          {/* Off-plan training. The workout row is created on the first tap, so a
              user who never trains freestyle never gets one in his plan. */}
          <li>
            <button
              type="button"
              aria-label="חופשי"
              data-active={selectedWorkout?.isFreestyle === true}
              className={cn(
                'card-flat w-full min-h-14 px-3 flex items-center gap-3 text-right border-dashed',
                selectedWorkout?.isFreestyle && 'border-accent/60 bg-accent-soft/40',
              )}
              onClick={async () => {
                const fs = await ensureFreestyleWorkout(activePlan.id);
                setSelectedWorkoutId(fs.id);
                setPickerOpen(false);
              }}
            >
              <IconPlus size={18} className="text-accent-text w-10 shrink-0" />
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold">אימון חופשי</span>
                <span className="block text-2xs text-fg-dim">מתחיל ריק, מוסיפים תרגילים תוך כדי</span>
              </span>
            </button>
          </li>
        </ul>
      </Modal>

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

      {/* Progress + Finish & Save live in the dock above the tab bar — in
          thumb reach, and in view however far down the list the user is. */}
      <WorkoutDock
        completed={completedCount}
        planned={plannedCount}
        drafts={drafts}
        getStartedAt={() => startedAtRef.current}
        onFinish={onAttemptSave}
      />

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
            {drafts.length > 1 && (
              <div className="flex justify-end -mb-1">
                <button
                  type="button"
                  className="btn-ghost !min-h-11 text-xs"
                  onClick={() => setReorderOpen(true)}
                >
                  <IconSort size={15} /> סדר תרגילים
                </button>
              </div>
            )}
            <AnimatePresence>
              {supersetRuns(drafts).map((run) => {
                const renderCard = (d: DraftExercise, runIndex: number) => {
                  const idx = drafts.indexOf(d);
                  const nextDraft = drafts[idx + 1];
                  const linkedToNext =
                    !!d.supersetGroup && nextDraft?.supersetGroup === d.supersetGroup;
                  return (
                    <ExerciseCard
                      key={d.exerciseId}
                      draft={d}
                      {...(run.length > 1 ? { superset: { members: run, index: runIndex } } : {})}
                      {...(nextDraft && !linkedToNext
                        ? { onLinkNext: () => void linkSuperset(d, nextDraft) }
                        : {})}
                      {...(run.length > 1 ? { onUnlink: () => void unlinkSuperset(d) } : {})}
                      isStalled={stalledIds.has(d.exerciseId)}
                      onChange={(next) =>
                        setDrafts((cur) =>
                          cur.map((c) => (c.exerciseId === next.exerciseId ? next : c)),
                        )
                      }
                      onRemove={() => {
                        setDrafts((cur) => cur.filter((c) => c.exerciseId !== d.exerciseId));
                        setRemovedIds((cur) => (cur.includes(d.exerciseId) ? cur : [...cur, d.exerciseId]));
                      }}
                      onSwap={() => setSwapTarget(d)}
                      {...(idx > 0 ? { onMoveUp: () => moveOne(d.exerciseId, -1) } : {})}
                      {...(idx < drafts.length - 1
                        ? { onMoveDown: () => moveOne(d.exerciseId, 1) }
                        : {})}
                      {...(drafts.length > 1 ? { onReorder: () => setReorderOpen(true) } : {})}
                      onRetire={async () => {
                        await archiveExercises([d.exerciseId]);
                        // Logged sets stay in today's session; an untouched card goes.
                        if (!d.sets.some((x) => x.completed)) {
                          setDrafts((cur) => cur.filter((c) => c.exerciseId !== d.exerciseId));
                        }
                        toast.success(`${d.exerciseName} הוצא מהתכנית. ההיסטוריה שלו בספריית התרגילים.`);
                      }}
                    />
                  );
                };
                if (run.length === 1) return renderCard(run[0]!, 0);
                return (
                  <div
                    key={`superset-${run[0]!.exerciseId}`}
                    className="relative ps-3 space-y-2"
                    aria-label="סופרסט"
                    role="group"
                  >
                    <span
                      className="absolute top-1 bottom-1 start-0 w-[3px] rounded-full bg-accent/70"
                      aria-hidden
                    />
                    <p className="eyebrow text-accent-text">
                      סופרסט · {run.length} תרגילים ברצף, מנוחה בסוף הסבב
                    </p>
                    {run.map((d, i) => renderCard(d, i))}
                  </div>
                );
              })}
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
        <SummaryBody drafts={drafts} completed={drafts.reduce((n, d) => n + doneWorkSets(d), 0)} planned={plannedCount} />
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
              .filter((d) => doneWorkSets(d) < d.targetSets)
              .map((d) => (
                <li key={d.exerciseId} className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-warn" />
                  {d.exerciseName}: {doneWorkSets(d)}/{d.targetSets}
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
            setRemovedIds((cur) => cur.filter((id) => id !== newDraft.exerciseId));
          }}
        />
      )}

      <ReorderExercisesModal
        open={reorderOpen}
        onClose={() => setReorderOpen(false)}
        drafts={drafts}
        onChange={(next) => {
          setDrafts(next);
          setReordered(true);
        }}
      />

      {selectedWorkoutId && (
        <SwapExerciseModal
          open={swapTarget !== null}
          onClose={() => setSwapTarget(null)}
          workoutId={selectedWorkoutId}
          target={swapTarget}
          existingDraftExerciseIds={new Set(drafts.map((d) => d.exerciseId))}
          onSwap={(incoming) => {
            const outgoing = swapTarget;
            if (!outgoing) return;
            const hasWork = outgoing.sets.some((x) => x.completed);
            setDrafts((cur) => {
              const idx = cur.findIndex((c) => c.exerciseId === outgoing.exerciseId);
              if (idx < 0) return [...cur, { ...incoming, order: cur.length }];
              const next = [...cur];
              // Sets already logged on the old exercise are never thrown away:
              // keep its card and put the new one right after it.
              if (hasWork) next.splice(idx + 1, 0, incoming);
              else next.splice(idx, 1, incoming);
              return next.map((c, i) => ({ ...c, order: i }));
            });
            setRemovedIds((cur) => {
              const without = cur.filter((id) => id !== incoming.exerciseId);
              return hasWork || without.includes(outgoing.exerciseId)
                ? without
                : [...without, outgoing.exerciseId];
            });
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
          navigate('/progress?tab=journal');
        }}
        title="האימון נשמר 🎉"
        footer={
          <button
            className="btn-primary"
            onClick={() => {
              setScoreModalOpen(false);
              setSaveResult(null);
              savingRef.current = false;
              navigate('/progress?tab=journal');
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
            const done = doneWorkSets(d);
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

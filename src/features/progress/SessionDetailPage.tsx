import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import { Section } from '@/components/Section';
import {
  IconArrowRight,
  IconCalendar,
  IconCheck,
  IconEdit,
  IconTrash,
  IconTrophy,
} from '@/components/Icon';
import { formatHebDateFull } from '@/utils/dates';
import { useState } from 'react';
import { Modal } from '@/components/Modal';
import { NumberInput } from '@/components/NumberInput';
import { confirmDialog } from '@/components/Confirm';
import { toast } from '@/store/toast';
import { statsForExercise, compareToPrevious, computeWorkoutScore } from '@/utils/scoring';
import { getExerciseStatsHistory } from '@/db/queries';
import type { SetLog } from '@/types';

/**
 * Re-derive the stored session aggregates (volume / score / prCount /
 * completionPct) from whatever is currently in the DB. Must run after any edit
 * to a set or to the session date, otherwise the journal, the charts and the
 * next session's volume baseline all keep showing the pre-edit numbers.
 */
async function recomputeSession(sessionId: string): Promise<void> {
  const session = await db.sessions.get(sessionId);
  if (!session) return;
  const logs = await db.exerciseLogs.where('sessionId').equals(sessionId).toArray();
  const sets = await db.setLogs.where('sessionId').equals(sessionId).toArray();

  let volume = 0;
  let loggedPlannedSets = 0;
  let completedSets = 0;
  let prCount = 0;
  for (const log of logs) {
    const mySets = sets.filter((s) => s.exerciseLogId === log.id);
    const cur = statsForExercise(sessionId, log.exerciseId, session.date, mySets, log.targetSets);
    volume += cur.volume;
    loggedPlannedSets += log.targetSets;
    completedSets += cur.completedSets;
    const hist = await getExerciseStatsHistory(log.exerciseId);
    const idx = hist.findIndex((h) => h.sessionId === sessionId);
    const allPrev = idx < 0 ? hist : hist.slice(0, idx);
    const tag = compareToPrevious(cur, allPrev[allPrev.length - 1] ?? null, allPrev);
    if (cur.completedSets > 0 && tag.kind === 'pr') prCount++;
  }

  // The 3 same-workout sessions that came before this one — the same baseline
  // saveSession used.
  const prevVolumes = (await db.sessions.where('workoutId').equals(session.workoutId).toArray())
    .filter(
      (s) =>
        s.status === 'completed' &&
        s.id !== sessionId &&
        (s.date < session.date ||
          (s.date === session.date && (s.startedAt ?? 0) < (session.startedAt ?? 0))),
    )
    .sort((a, b) =>
      a.date === b.date ? (b.startedAt ?? 0) - (a.startedAt ?? 0) : a.date < b.date ? 1 : -1,
    )
    .slice(0, 3)
    .map((s) => s.totalVolume ?? 0);

  // Skipped exercises write no ExerciseLog, so the logs alone under-count what
  // was planned. Use the figure stored at save time; fall back to the logs only
  // for sessions saved before that field existed.
  const plannedSets = session.plannedSets ?? loggedPlannedSets;

  const score = computeWorkoutScore({
    currentVolume: volume,
    prevVolumes,
    prCount,
    plannedSets,
    completedSets,
  });
  await db.sessions.update(sessionId, {
    totalVolume: volume,
    score: score.score,
    prCount,
    completionPct: score.completionPct,
    plannedSets,
  });
}

/**
 * Rescore this session AND every session after it, oldest first.
 *
 * PRs are relative: lowering a weight in an old session can turn a later
 * session into a record it wasn't, or strip one it was. Rescoring only the
 * edited session left the journal showing a שיא on a session the very same
 * screen was tagging ירידה. A single user has hundreds of sessions at most, so
 * walking the tail is cheap and always right.
 */
async function recomputeFrom(sessionId: string): Promise<void> {
  const edited = await db.sessions.get(sessionId);
  if (!edited) return;
  const isAfter = (s: { date: string; startedAt?: number }) =>
    s.date > edited.date ||
    (s.date === edited.date && (s.startedAt ?? 0) >= (edited.startedAt ?? 0));
  const tail = (await db.sessions.toArray())
    .filter((s) => s.status === 'completed' && isAfter(s))
    .sort((a, b) =>
      a.date === b.date ? (a.startedAt ?? 0) - (b.startedAt ?? 0) : a.date < b.date ? -1 : 1,
    );
  for (const s of tail) await recomputeSession(s.id);
}

export function SessionDetailPage() {
  const { sessionId = '' } = useParams();
  const navigate = useNavigate();
  const session = useLiveQuery(() => db.sessions.get(sessionId), [sessionId]);
  const logs = useLiveQuery(
    () => db.exerciseLogs.where('sessionId').equals(sessionId).sortBy('order'),
    [sessionId],
  ) ?? [];
  const sets = useLiveQuery(
    () => db.setLogs.where('sessionId').equals(sessionId).toArray(),
    [sessionId],
  ) ?? [];

  const [editing, setEditing] = useState<{ setId: string; weight: number | ''; reps: number | '' } | null>(null);
  const [dateEditOpen, setDateEditOpen] = useState(false);
  const [dateDraft, setDateDraft] = useState('');

  if (!session) {
    return (
      <div className="pt-6">
        <Link to="/progress" className="btn-subtle"><IconArrowRight /> חזרה</Link>
        <p className="text-fg-muted text-center mt-6">האימון לא נמצא.</p>
      </div>
    );
  }

  const setsByLog = new Map<string, SetLog[]>();
  for (const s of sets) {
    const arr = setsByLog.get(s.exerciseLogId) ?? [];
    arr.push(s);
    setsByLog.set(s.exerciseLogId, arr);
  }

  const onDelete = async () => {
    const ok = await confirmDialog({
      title: 'למחוק את האימון?',
      body: 'הפעולה לא הפיכה.',
      destructive: true,
      confirmLabel: 'מחק',
    });
    if (!ok) return;
    await db.transaction('rw', [db.sessions, db.exerciseLogs, db.setLogs], async () => {
      await db.setLogs.where('sessionId').equals(session.id).delete();
      await db.exerciseLogs.where('sessionId').equals(session.id).delete();
      await db.sessions.delete(session.id);
    });
    toast.success('האימון נמחק');
    navigate('/progress', { replace: true });
  };

  return (
    <div className="pt-3">
      <Link to="/progress" className="btn-subtle !min-h-9 !px-2 text-xs mb-2 inline-flex">
        <IconArrowRight size={14} /> חזרה ליומן
      </Link>

      <header className="mb-5">
        <div className="flex items-start gap-1">
          <div className="min-w-0 flex-1">
            <p className="eyebrow truncate">
              <span className="num-display text-accent-text">{session.workoutCode}</span> ·{' '}
              {session.workoutName}
            </p>
            <h1 className="text-2xl font-extrabold tracking-tight mt-0.5">
              {formatHebDateFull(session.date)}
            </h1>
          </div>
          <button
            className="btn-icon !min-w-9 !min-h-9 shrink-0"
            aria-label="ערוך תאריך"
            onClick={() => {
              setDateDraft(session.date);
              setDateEditOpen(true);
            }}
          >
            <IconCalendar size={18} />
          </button>
          {/* Destructive, so quiet until reached for. */}
          <button
            className="btn-subtle !min-h-9 !px-2 text-xs shrink-0 text-fg-ghost hover:text-bad"
            onClick={onDelete}
          >
            <IconTrash size={14} /> מחק
          </button>
        </div>

        {/* The session's three figures, read left-to-right as one row. */}
        <div className="flex gap-2 mt-3">
          <div className="card-flat flex-1 px-3 py-2">
            <p className="eyebrow">ציון</p>
            <p className="num-display text-2xl mt-0.5 leading-none">{session.score ?? '—'}</p>
          </div>
          <div className="card-flat flex-1 px-3 py-2">
            <p className="eyebrow">נפח</p>
            <p className="num-display text-2xl mt-0.5 leading-none">
              {(session.totalVolume ?? 0).toLocaleString('he-IL')}kg
            </p>
          </div>
          {(session.prCount ?? 0) > 0 && (
            <div className="card-flat flex-1 px-3 py-2">
              <p className="eyebrow">שיאים</p>
              <p className="num-display text-2xl mt-0.5 leading-none text-warn">
                {session.prCount}
              </p>
            </div>
          )}
        </div>

        {session.notes && (
          <p className="field mt-3 px-3 py-2 text-xs text-fg-muted italic">"{session.notes}"</p>
        )}
      </header>

      <Section title="תרגילים">
        <ul className="space-y-2">
          {logs.map((log) => (
            <ExerciseLogCard
              key={log.id}
              log={log}
              sets={(setsByLog.get(log.id) ?? []).sort((a, b) => a.setNumber - b.setNumber)}
              sessionId={session.id}
              sessionDate={session.date}
              onEditSet={(s) =>
                setEditing({ setId: s.id, weight: s.weight, reps: s.reps })
              }
            />
          ))}
        </ul>
      </Section>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title="עריכת סט"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setEditing(null)}>
              ביטול
            </button>
            <button
              className="btn-primary"
              onClick={async () => {
                if (!editing) return;
                await db.setLogs.update(editing.setId, {
                  weight: editing.weight === '' ? 0 : Number(editing.weight),
                  reps: editing.reps === '' ? 0 : Number(editing.reps),
                });
                await recomputeFrom(session.id);
                setEditing(null);
                toast.success('עודכן');
              }}
            >
              <IconCheck size={16} /> שמור
            </button>
          </>
        }
      >
        {editing && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">משקל (kg נטו)</label>
              <NumberInput
                ariaLabel="משקל (kg נטו)"
                value={editing.weight}
                onChange={(v) => setEditing({ ...editing, weight: v })}
                step={2.5}
                decimals={2}
                min={0}
                withSteppers
              />
            </div>
            <div>
              <label className="label">חזרות</label>
              <NumberInput
                ariaLabel="חזרות"
                value={editing.reps}
                onChange={(v) => setEditing({ ...editing, reps: v })}
                step={1}
                decimals={0}
                min={0}
                withSteppers
              />
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={dateEditOpen}
        onClose={() => setDateEditOpen(false)}
        title="עריכת תאריך אימון"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setDateEditOpen(false)}>
              ביטול
            </button>
            <button
              className="btn-primary"
              onClick={async () => {
                if (!dateDraft) return;
                await db.sessions.update(session.id, { date: dateDraft });
                await recomputeFrom(session.id);
                toast.success('התאריך עודכן');
                setDateEditOpen(false);
              }}
            >
              שמור
            </button>
          </>
        }
      >
        <input
          type="date"
          className="input"
          value={dateDraft}
          onChange={(e) => setDateDraft(e.target.value)}
        />
      </Modal>
    </div>
  );
}

function ExerciseLogCard({
  log,
  sets,
  sessionId,
  sessionDate,
  onEditSet,
}: {
  log: { id: string; exerciseId: string; exerciseName: string; muscleGroupName: string; targetSets: number; targetRepsMin: number; targetRepsMax: number };
  sets: SetLog[];
  sessionId: string;
  sessionDate: string;
  onEditSet: (s: SetLog) => void;
}) {
  // compute comparison tag for this exercise relative to all prior history
  const tag = useLiveQuery(async () => {
    // getExerciseStatsHistory is already oldest → newest with a startedAt tiebreak.
    const allStats = await getExerciseStatsHistory(log.exerciseId);
    const target = allStats.findIndex((s) => s.sessionId === sessionId);
    const cur = allStats[target];
    if (!cur) return null;
    const allPrev = allStats.slice(0, target);
    return compareToPrevious(cur, allPrev[allPrev.length - 1] ?? null, allPrev);
  }, [log.id, sessionId, sessionDate]);

  const completedSets = sets.filter((s) => s.completed);
  const stats = statsForExercise(log.id, log.exerciseId, sessionDate, completedSets, log.targetSets);

  return (
    <li className="card overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-line/60">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate">{log.exerciseName}</p>
          <p className="text-2xs text-fg-muted truncate">
            {log.muscleGroupName} · {log.targetSets}×{log.targetRepsMin}-{log.targetRepsMax}
          </p>
        </div>
        {tag && <ComparisonTag kind={tag.kind} label={tag.label} />}
      </div>

      <div className="p-2.5">
        <div className="grid grid-cols-3 gap-1.5 mb-2">
          <Mini label="משקל" value={`${stats.topWeight}kg`} />
          <Mini label="נפח" value={`${stats.volume.toLocaleString('he-IL')}kg`} />
          <Mini label="1RM" value={stats.est1RM.toFixed(1)} />
        </div>
        <ul className="space-y-1">
          {sets.map((s) => (
            <li
              key={s.id}
              className="field flex items-center gap-2 ps-2.5 pe-1 py-1 text-xs rounded-lg"
            >
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  s.completed ? 'bg-good' : 'bg-fg-ghost'
                }`}
                aria-hidden
              />
              <span className="num text-2xs text-fg-dim shrink-0">סט {s.setNumber}</span>
              <span className="num-display ms-auto">
                {s.weight}kg × {s.reps}
              </span>
              {s.rpe !== undefined && (
                <span className="num text-2xs text-fg-dim shrink-0">RPE {s.rpe}</span>
              )}
              <button
                className="btn-icon !min-w-8 !min-h-9 shrink-0 text-fg-dim hover:text-info"
                aria-label="ערוך סט"
                onClick={() => onEditSet(s)}
              >
                <IconEdit size={14} />
              </button>
              <button
                className="btn-icon !min-w-8 !min-h-9 shrink-0 text-fg-ghost hover:text-bad"
                aria-label="מחק סט"
                onClick={async () => {
                  const ok = await confirmDialog({
                    title: 'למחוק את הסט?',
                    destructive: true,
                    confirmLabel: 'מחק',
                  });
                  if (!ok) return;
                  // Last set of the exercise → drop the exerciseLog too, or it
                  // stays behind as a 0kg / 0-volume point in the exercise's
                  // history and fakes PRs and stalls.
                  const wasLastSet = sets.length === 1;
                  await db.transaction('rw', [db.setLogs, db.exerciseLogs], async () => {
                    await db.setLogs.delete(s.id);
                    if (wasLastSet) await db.exerciseLogs.delete(s.exerciseLogId);
                  });
                  await recomputeFrom(s.sessionId);
                }}
              >
                <IconTrash size={14} />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </li>
  );
}

/**
 * "שיא / שיפור / ירידה" is a status, not a headline: a hairline border and a
 * tint at a few percent, never a filled slab.
 */
const TAG_STYLE: Record<string, string> = {
  pr: 'border-warn/25 bg-warn/[0.07] text-warn',
  up: 'border-good/25 bg-good/[0.06] text-good',
  down: 'border-bad/25 bg-bad/[0.06] text-bad',
};

function ComparisonTag({ kind, label }: { kind: string; label: string }) {
  return (
    <span className={`chip shrink-0 ${TAG_STYLE[kind] ?? 'border-line text-fg-dim'}`}>
      {kind === 'pr' && <IconTrophy size={11} />} {label}
    </span>
  );
}

/** A figure inside a card is recessed — the card is the raised surface, not it. */
function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="field px-2 py-1.5">
      <p className="eyebrow truncate">{label}</p>
      <p className="num-display text-sm mt-0.5">{value}</p>
    </div>
  );
}

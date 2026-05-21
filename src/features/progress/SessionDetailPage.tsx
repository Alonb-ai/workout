import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, now } from '@/db/db';
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
import { statsForExercise, compareToPrevious } from '@/utils/scoring';
import { getExerciseStatsHistory } from '@/db/queries';
import type { SetLog } from '@/types';

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

      <header className="mb-4">
        <p className="text-2xs uppercase tracking-wider text-fg-muted">
          <span className="num">{session.workoutCode}</span> · {session.workoutName}
        </p>
        <div className="flex items-center gap-2 mt-1">
          <h1 className="text-2xl font-extrabold">{formatHebDateFull(session.date)}</h1>
          <button
            className="btn-icon !min-w-9 !min-h-9 text-fg-muted"
            aria-label="ערוך תאריך"
            onClick={() => {
              setDateDraft(session.date);
              setDateEditOpen(true);
            }}
          >
            <IconCalendar size={18} />
          </button>
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          <div className="card-flat px-3 py-2">
            <p className="text-2xs text-fg-muted">ציון</p>
            <p className="num text-xl font-bold">{session.score ?? '—'}</p>
          </div>
          <div className="card-flat px-3 py-2">
            <p className="text-2xs text-fg-muted">נפח</p>
            <p className="num text-xl font-bold">
              {(session.totalVolume ?? 0).toLocaleString('he-IL')}kg
            </p>
          </div>
          {(session.prCount ?? 0) > 0 && (
            <div className="card-flat px-3 py-2">
              <p className="text-2xs text-fg-muted">שיאים</p>
              <p className="num text-xl font-bold text-warn">{session.prCount}</p>
            </div>
          )}
          <button
            className="ms-auto btn-ghost !min-h-9 !px-2 text-xs text-bad"
            onClick={onDelete}
          >
            <IconTrash size={14} /> מחק
          </button>
        </div>
        {session.notes && (
          <p className="text-xs text-fg-muted mt-3 italic">"{session.notes}"</p>
        )}
      </header>

      <Section title="תרגילים">
        <ul className="space-y-2">
          {logs.map((log) => (
            <ExerciseLogCard
              key={log.id}
              log={log}
              sets={(setsByLog.get(log.id) ?? []).sort((a, b) => a.setNumber - b.setNumber)}
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
                value={editing.weight}
                onChange={(v) => setEditing({ ...editing, weight: v })}
                step={2.5}
                decimals={2}
                withSteppers
              />
            </div>
            <div>
              <label className="label">חזרות</label>
              <NumberInput
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
  sessionDate,
  onEditSet,
}: {
  log: { id: string; exerciseId: string; exerciseName: string; muscleGroupName: string; targetSets: number; targetRepsMin: number; targetRepsMax: number };
  sets: SetLog[];
  sessionDate: string;
  onEditSet: (s: SetLog) => void;
}) {
  // compute comparison tag for this exercise relative to all prior history
  const tag = useLiveQuery(async () => {
    const allStats = await getExerciseStatsHistory(log.exerciseId);
    const sortByDate = [...allStats].sort((a, b) => (a.date < b.date ? -1 : 1));
    const target = sortByDate.findIndex((s) => s.date === sessionDate && s.exerciseId === log.exerciseId);
    if (target < 0) return null;
    const cur = sortByDate[target];
    if (!cur) return null;
    const prev = target > 0 ? sortByDate[target - 1]! : null;
    const allPrev = sortByDate.slice(0, target);
    return compareToPrevious(cur, prev, allPrev);
  }, [log.id, sessionDate]);

  const completedSets = sets.filter((s) => s.completed);
  const stats = statsForExercise(log.id, log.exerciseId, sessionDate, completedSets, log.targetSets);

  return (
    <li className="card p-3">
      <div className="flex items-center gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate">{log.exerciseName}</p>
          <p className="text-2xs text-fg-muted">
            {log.muscleGroupName} · {log.targetSets}×{log.targetRepsMin}-{log.targetRepsMax}
          </p>
        </div>
        {tag && (
          <span
            className={`chip ${
              tag.kind === 'pr'
                ? 'border-warn/40 text-warn bg-warn-soft'
                : tag.kind === 'up'
                  ? 'border-good/40 text-good bg-good-soft'
                  : tag.kind === 'down'
                    ? 'border-bad/40 text-bad bg-bad-soft'
                    : 'border-line text-fg-muted'
            }`}
          >
            {tag.kind === 'pr' && <IconTrophy size={11} />} {tag.label}
          </span>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2 mb-2">
        <Mini label="משקל" value={`${stats.topWeight}kg`} />
        <Mini label="נפח" value={`${stats.volume.toLocaleString('he-IL')}kg`} />
        <Mini label="1RM" value={stats.est1RM.toFixed(1)} />
      </div>
      <ul className="space-y-1">
        {sets.map((s) => (
          <li
            key={s.id}
            className="flex items-center justify-between gap-2 bg-ink-900 rounded-lg px-2.5 py-1.5 text-xs"
          >
            <span className="num text-fg-muted">סט {s.setNumber}</span>
            <span className="num font-semibold">
              {s.weight}kg × {s.reps}
              {s.rpe !== undefined && (
                <span className="text-fg-muted text-2xs ms-2">RPE {s.rpe}</span>
              )}
            </span>
            <span
              className={`chip ${
                s.completed
                  ? 'border-good/40 text-good bg-good-soft'
                  : 'border-fg-ghost text-fg-muted'
              }`}
            >
              {s.completed ? '✓' : '○'}
            </span>
            <button
              className="btn-icon !min-w-7 !min-h-7"
              aria-label="ערוך סט"
              onClick={() => onEditSet(s)}
            >
              <IconEdit size={14} />
            </button>
            <button
              className="btn-icon !min-w-7 !min-h-7 text-bad/80"
              aria-label="מחק סט"
              onClick={async () => {
                const ok = await confirmDialog({
                  title: 'למחוק את הסט?',
                  destructive: true,
                  confirmLabel: 'מחק',
                });
                if (!ok) return;
                await db.setLogs.delete(s.id);
                // recompute session totals quickly
                const remaining = await db.setLogs.where('sessionId').equals(s.sessionId).toArray();
                const vol = remaining.reduce(
                  (sum, x) => (x.completed ? sum + x.weight * x.reps : sum),
                  0,
                );
                await db.sessions.update(s.sessionId, { totalVolume: vol, finishedAt: now() });
              }}
            >
              <IconTrash size={14} />
            </button>
          </li>
        ))}
      </ul>
    </li>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="card-flat p-2">
      <p className="text-2xs text-fg-muted">{label}</p>
      <p className="num text-sm font-bold">{value}</p>
    </div>
  );
}

import { addDays, format, parseISO, startOfWeek } from 'date-fns';
import { he } from 'date-fns/locale';
import type { ExerciseLog, ISODate, Session, SetLog } from '@/types';
import { totalVolume } from './scoring';

/**
 * Plain-text workout summaries meant for another reader: an AI assistant the
 * user mails them to (via an iOS Shortcut), or anyone he pastes them to.
 *
 * Written to be read by a model as much as by a person: every number carries
 * its unit, weights are labelled NET (bar excluded, per the app's contract),
 * and the previous attempt at each exercise is included so a reader can judge
 * progress without access to the app's history.
 */

export interface ExerciseBundle {
  log: ExerciseLog;
  sets: SetLog[];
}

export interface SessionBundle {
  session: Session;
  exercises: ExerciseBundle[];
}

/** The most recent earlier attempt at one exercise. */
export interface PreviousAttempt {
  date: ISODate;
  sets: SetLog[];
}

function completedSets(sets: SetLog[]): SetLog[] {
  return sets.filter((s) => s.completed).sort((a, b) => a.setNumber - b.setNumber);
}

function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

/** "60×8, 60×8, 57.5×7" — kg × reps, completed sets only. 0 kg reads as bodyweight. */
export function formatSets(sets: SetLog[]): string {
  const done = completedSets(sets);
  if (done.length === 0) return 'לא בוצעו סטים';
  return done
    .map((s) => (s.isDrop ? 'דרופ ' : '') + (s.weight === 0 ? `משקל גוף×${s.reps}` : `${fmtNum(s.weight)}×${s.reps}`))
    .join(', ');
}

function fmtDate(iso: ISODate): string {
  return format(parseISO(iso), 'EEEE d.M.yyyy', { locale: he });
}

function durationMinutes(s: Session): number | null {
  if (!s.finishedAt || s.finishedAt <= s.startedAt) return null;
  const min = Math.round((s.finishedAt - s.startedAt) / 60000);
  // A draft committed days later has a meaningless span.
  return min > 0 && min <= 300 ? min : null;
}

function sessionVolume(b: SessionBundle): number {
  return (
    b.session.totalVolume ??
    b.exercises.reduce((sum, e) => sum + totalVolume(completedSets(e.sets)), 0)
  );
}

/** "אימון אחד" / "3 אימונים" — Hebrew counts read wrong as "1 אימונים". */
function count(n: number, one: string, many: string): string {
  return n === 1 ? one : `${n} ${many}`;
}

function titled(name: string): string {
  return name.trim().startsWith('אימון') ? name.trim() : `אימון ${name.trim()}`;
}

const UNITS_NOTE = 'משקלים בק״ג נטו (בלי משקל המוט). פורמט סט: משקל×חזרות.';

/**
 * One finished session, exercise by exercise, each next to its previous
 * attempt. `previous` is keyed by exerciseId.
 */
export function buildWorkoutSummary(
  bundle: SessionBundle,
  previous: Map<string, PreviousAttempt>,
): string {
  const { session } = bundle;
  const lines: string[] = [];
  lines.push(`${titled(session.workoutName)} — ${fmtDate(session.date)}`);

  const facts: string[] = [];
  const mins = durationMinutes(session);
  if (mins !== null) facts.push(`משך ${mins} דק׳`);
  facts.push(`נפח ${Math.round(sessionVolume(bundle))} ק״ג`);
  if (session.score !== undefined) facts.push(`ציון ${Math.round(session.score)}/100`);
  if (session.prCount) facts.push(count(session.prCount, 'שיא אחד', 'שיאים'));
  if (session.completionPct !== undefined) facts.push(`השלמה ${Math.round(session.completionPct)}%`);
  lines.push(facts.join(' · '));
  lines.push(UNITS_NOTE);
  lines.push('');

  const ordered = [...bundle.exercises].sort((a, b) => a.log.order - b.log.order);
  for (const { log, sets } of ordered) {
    const range =
      log.targetRepsMin === log.targetRepsMax
        ? `${log.targetRepsMax}`
        : `${log.targetRepsMin}–${log.targetRepsMax}`;
    lines.push(`• ${log.exerciseName} (יעד ${log.targetSets}×${range})`);
    lines.push(`  היום: ${formatSets(sets)}`);
    const prev = previous.get(log.exerciseId);
    lines.push(
      prev ? `  פעם קודמת (${fmtDate(prev.date)}): ${formatSets(prev.sets)}` : '  פעם ראשונה',
    );
    if (log.notes?.trim()) lines.push(`  הערה: ${log.notes.trim()}`);
  }

  if (session.notes?.trim()) {
    lines.push('');
    lines.push(`הערות לאימון: ${session.notes.trim()}`);
  }
  return lines.join('\n');
}

/** Sunday of the week containing `day` (the Israeli week), as ISO. */
export function weekStartISO(day: Date): ISODate {
  return format(startOfWeek(day, { weekStartsOn: 0 }), 'yyyy-MM-dd');
}

/**
 * The Sunday–Saturday week starting at `weekStart`. `sessions` may contain
 * anything; only completed sessions inside the week (and the week before, for
 * the comparison line) are used.
 */
export function buildWeeklySummary(sessions: SessionBundle[], weekStart: ISODate): string {
  const start = parseISO(weekStart);
  const weekEnd = format(addDays(start, 6), 'yyyy-MM-dd');
  const prevStart = format(addDays(start, -7), 'yyyy-MM-dd');
  const done = sessions.filter((b) => b.session.status === 'completed');
  const inWeek = done
    .filter((b) => b.session.date >= weekStart && b.session.date <= weekEnd)
    .sort((a, b) => (a.session.date < b.session.date ? -1 : a.session.date > b.session.date ? 1 : a.session.startedAt - b.session.startedAt));
  const prevWeek = done.filter(
    (b) => b.session.date >= prevStart && b.session.date < weekStart,
  );

  const lines: string[] = [];
  lines.push(
    `סיכום שבועי ${format(start, 'd.M')}–${format(parseISO(weekEnd), 'd.M.yyyy')}`,
  );
  if (inWeek.length === 0) {
    lines.push('לא נרשמו אימונים השבוע.');
    if (prevWeek.length > 0) lines.push(`בשבוע הקודם: ${count(prevWeek.length, 'אימון אחד', 'אימונים')}.`);
    return lines.join('\n');
  }

  const vol = inWeek.reduce((s, b) => s + sessionVolume(b), 0);
  const prevVol = prevWeek.reduce((s, b) => s + sessionVolume(b), 0);
  const prs = inWeek.reduce((s, b) => s + (b.session.prCount ?? 0), 0);
  const sets = inWeek.reduce(
    (s, b) => s + b.exercises.reduce((n, e) => n + completedSets(e.sets).filter((x) => !x.isDrop).length, 0),
    0,
  );
  lines.push(
    `${count(inWeek.length, 'אימון אחד', 'אימונים')} · ${count(sets, 'סט אחד', 'סטים')} · נפח ${Math.round(vol)} ק״ג · ${prs === 1 ? 'שיא אחד' : `${prs} שיאים`}`,
  );
  if (prevWeek.length > 0 && prevVol > 0) {
    const pct = Math.round(((vol - prevVol) / prevVol) * 100);
    const sign = pct > 0 ? '+' : '';
    lines.push(
      `שבוע קודם: ${count(prevWeek.length, 'אימון אחד', 'אימונים')}, נפח ${Math.round(prevVol)} ק״ג (${sign}${pct}%)`,
    );
  }
  lines.push(UNITS_NOTE);

  for (const b of inWeek) {
    lines.push('');
    const head: string[] = [`${fmtDate(b.session.date)} — ${b.session.workoutName}`];
    if (b.session.score !== undefined) head.push(`ציון ${Math.round(b.session.score)}`);
    head.push(`נפח ${Math.round(sessionVolume(b))} ק״ג`);
    lines.push(head.join(' · '));
    const ordered = [...b.exercises].sort((x, y) => x.log.order - y.log.order);
    for (const { log, sets: s } of ordered) {
      const note = log.notes?.trim() ? ` (הערה: ${log.notes.trim()})` : '';
      lines.push(`• ${log.exerciseName}: ${formatSets(s)}${note}`);
    }
    if (b.session.notes?.trim()) lines.push(`הערות: ${b.session.notes.trim()}`);
  }
  return lines.join('\n');
}

/**
 * For each exercise in `target`, its most recent earlier completed attempt
 * among `all`. "Earlier" = an earlier date, or the same date and an earlier
 * start, so two sessions on one day still compare correctly.
 */
export function previousAttempts(
  target: SessionBundle,
  all: SessionBundle[],
): Map<string, PreviousAttempt> {
  const t = target.session;
  const earlier = all
    .filter(
      (b) =>
        b.session.id !== t.id &&
        b.session.status === 'completed' &&
        (b.session.date < t.date || (b.session.date === t.date && b.session.startedAt < t.startedAt)),
    )
    .sort((a, b) =>
      a.session.date === b.session.date
        ? b.session.startedAt - a.session.startedAt
        : a.session.date < b.session.date
          ? 1
          : -1,
    );
  const out = new Map<string, PreviousAttempt>();
  for (const { log } of target.exercises) {
    for (const b of earlier) {
      const hit = b.exercises.find(
        (e) => e.log.exerciseId === log.exerciseId && completedSets(e.sets).length > 0,
      );
      if (hit) {
        out.set(log.exerciseId, { date: b.session.date, sets: hit.sets });
        break;
      }
    }
  }
  return out;
}

/** Latest completed session: by date, then by start time. */
export function latestCompleted(all: SessionBundle[]): SessionBundle | null {
  let best: SessionBundle | null = null;
  for (const b of all) {
    if (b.session.status !== 'completed') continue;
    if (
      !best ||
      b.session.date > best.session.date ||
      (b.session.date === best.session.date && b.session.startedAt > best.session.startedAt)
    ) {
      best = b;
    }
  }
  return best;
}

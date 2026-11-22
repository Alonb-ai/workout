import { describe, expect, it } from 'vitest';
import type { ExerciseLog, Session, SetLog } from '@/types';
import {
  buildWeeklySummary,
  buildWorkoutSummary,
  formatSets,
  latestCompleted,
  previousAttempts,
  weekStartISO,
  type SessionBundle,
} from './summaryText';

function session(id: string, date: string, extra: Partial<Session> = {}): Session {
  return {
    id,
    workoutId: 'w1',
    planId: 'p1',
    workoutName: 'Upper A',
    workoutCode: 'UA',
    date,
    startedAt: Date.parse(`${date}T18:00:00`),
    finishedAt: Date.parse(`${date}T19:05:00`),
    status: 'completed',
    ...extra,
  };
}

function log(id: string, sessionId: string, exerciseId: string, name: string, extra: Partial<ExerciseLog> = {}): ExerciseLog {
  return {
    id,
    sessionId,
    exerciseId,
    order: 0,
    exerciseName: name,
    muscleGroupName: 'חזה',
    targetSets: 3,
    targetRepsMin: 6,
    targetRepsMax: 8,
    barWeight: 20,
    ...extra,
  };
}

function sets(logId: string, sessionId: string, exerciseId: string, spec: [number, number, boolean?][]): SetLog[] {
  return spec.map(([weight, reps, completed = true], i) => ({
    id: `${logId}-s${i}`,
    exerciseLogId: logId,
    sessionId,
    exerciseId,
    setNumber: i + 1,
    weight,
    reps,
    completed,
  }));
}

function bundle(s: Session, ex: { log: ExerciseLog; spec: [number, number, boolean?][] }[]): SessionBundle {
  return {
    session: s,
    exercises: ex.map((e) => ({ log: e.log, sets: sets(e.log.id, s.id, e.log.exerciseId, e.spec) })),
  };
}

describe('formatSets', () => {
  it('lists completed sets only, in set order, with bodyweight named', () => {
    const s = sets('l', 's', 'e', [[60, 8], [0, 12], [57.5, 7], [60, 0, false]]);
    expect(formatSets(s)).toBe('60×8, משקל גוף×12, 57.5×7');
  });
  it('says so when nothing was done', () => {
    expect(formatSets(sets('l', 's', 'e', [[60, 8, false]]))).toBe('לא בוצעו סטים');
  });
});

describe('buildWorkoutSummary', () => {
  const old = bundle(session('s1', '2026-11-16'), [
    { log: log('a1', 's1', 'bench', 'לחיצת חזה'), spec: [[60, 8], [60, 8], [60, 7]] },
  ]);
  const now = bundle(session('s2', '2026-11-19', { score: 78.4, totalVolume: 1500, prCount: 1, notes: 'כתף קצת כואבת' }), [
    { log: log('a2', 's2', 'bench', 'לחיצת חזה', { notes: 'אחיזה רחבה' }), spec: [[62.5, 8], [62.5, 7], [62.5, 6]] },
    { log: log('b2', 's2', 'row', 'חתירה', { order: 1 }), spec: [[50, 10]] },
  ]);

  it('puts each exercise next to its previous attempt, with notes and units', () => {
    const text = buildWorkoutSummary(now, previousAttempts(now, [old, now]));
    expect(text).toContain('אימון Upper A');
    expect(text).toContain('משך 65 דק׳');
    expect(text).toContain('נפח 1500 ק״ג');
    expect(text).toContain('ציון 78/100');
    expect(text).toContain('נטו');
    expect(text).toContain('היום: 62.5×8, 62.5×7, 62.5×6');
    expect(text).toContain('פעם קודמת');
    expect(text).toContain('60×8, 60×8, 60×7');
    expect(text).toContain('הערה: אחיזה רחבה');
    expect(text).toContain('פעם ראשונה'); // the row
    expect(text).toContain('הערות לאימון: כתף קצת כואבת');
    expect(text.indexOf('לחיצת חזה')).toBeLessThan(text.indexOf('חתירה'));
  });

  it('does not double the word אימון', () => {
    const b = bundle(session('f', '2026-11-20', { workoutName: 'אימון חופשי' }), []);
    expect(buildWorkoutSummary(b, new Map())).toMatch(/^אימון חופשי — /);
  });

  it('never uses a later session as "previous"', () => {
    const prev = previousAttempts(old, [old, now]);
    expect(prev.size).toBe(0);
  });

  it('omits duration for a draft committed days later', () => {
    const late = bundle(
      session('s3', '2026-11-19', { finishedAt: Date.parse('2026-11-22T10:00:00') }),
      [],
    );
    expect(buildWorkoutSummary(late, new Map())).not.toContain('משך');
  });
});

describe('latestCompleted', () => {
  it('picks the newest completed session, ignoring drafts', () => {
    const a = bundle(session('a', '2026-11-18'), []);
    const b = bundle(session('b', '2026-11-20', { status: 'draft' }), []);
    const c = bundle(session('c', '2026-11-19'), []);
    expect(latestCompleted([a, b, c])?.session.id).toBe('c');
    expect(latestCompleted([])).toBeNull();
  });
});

describe('weekly summary', () => {
  it('weeks start on Sunday', () => {
    expect(weekStartISO(new Date('2026-11-22T12:00:00'))).toBe('2026-11-22'); // Sunday
    expect(weekStartISO(new Date('2026-11-21T12:00:00'))).toBe('2026-11-15'); // Saturday
  });

  it('covers only this week and compares to last week', () => {
    const lastWeek = bundle(session('p', '2026-11-12', { totalVolume: 1000 }), []);
    const mon = bundle(session('m', '2026-11-16', { totalVolume: 600, prCount: 1 }), [
      { log: log('x', 'm', 'bench', 'לחיצת חזה'), spec: [[60, 8], [60, 8]] },
    ]);
    const thu = bundle(session('t', '2026-11-19', { totalVolume: 600 }), []);
    const nextWeek = bundle(session('n', '2026-11-23', { totalVolume: 9999 }), []);
    const text = buildWeeklySummary([lastWeek, mon, thu, nextWeek], '2026-11-15');
    expect(text).toContain('2 אימונים · 2 סטים · נפח 1200 ק״ג · שיא אחד');
    expect(text).toContain('שבוע קודם: אימון אחד, נפח 1000 ק״ג (+20%)');
    expect(text).toContain('• לחיצת חזה: 60×8, 60×8');
    expect(text).not.toContain('9999');
  });

  it('says plainly when the week is empty', () => {
    expect(buildWeeklySummary([], '2026-11-22')).toContain('לא נרשמו אימונים השבוע');
  });
});

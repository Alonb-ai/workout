import { describe, it, expect } from 'vitest';
import type { BodyMeasurement, ExerciseLog, Session, SetLog } from '@/types';
import { buildWeeklySummary, shiftWeek, weekStartOf, weeklySummaryText } from './weeklySummary';

interface Fx {
  sessions: Session[];
  logs: ExerciseLog[];
  sets: SetLog[];
}
const fx = (): Fx => ({ sessions: [], logs: [], sets: [] });

let n = 0;
/** exercise id → { muscle, rows: [weight, reps][] } */
function session(
  f: Fx,
  date: string,
  exercises: Record<string, [number, number][]>,
  muscle: Record<string, string> = {},
  status: Session['status'] = 'completed',
): void {
  const id = `s${++n}`;
  f.sessions.push({
    id,
    workoutId: 'w',
    planId: 'p',
    workoutName: 'A',
    workoutCode: 'UA',
    date,
    startedAt: n,
    status,
  });
  for (const [ex, rows] of Object.entries(exercises)) {
    const logId = `${id}-${ex}`;
    f.logs.push({
      id: logId,
      sessionId: id,
      exerciseId: ex,
      order: 0,
      exerciseName: ex,
      muscleGroupName: muscle[ex] ?? 'חזה',
      targetSets: 3,
      targetRepsMin: 8,
      targetRepsMax: 10,
      barWeight: 0,
    });
    rows.forEach(([weight, reps], i) =>
      f.sets.push({
        id: `${logId}-${i}`,
        exerciseLogId: logId,
        sessionId: id,
        exerciseId: ex,
        setNumber: i + 1,
        weight,
        reps,
        completed: true,
      }),
    );
  }
}

// 2026-11-22 is a Sunday.
const WEEK = '2026-11-22';

describe('week boundaries', () => {
  it('starts weeks on Sunday', () => {
    expect(weekStartOf('2026-11-22')).toBe('2026-11-22');
    expect(weekStartOf('2026-11-28')).toBe('2026-11-22'); // Saturday
    expect(weekStartOf('2026-11-21')).toBe('2026-11-15');
    expect(shiftWeek(WEEK, -1)).toBe('2026-11-15');
  });

  it('reports an inclusive Saturday end', () => {
    const s = buildWeeklySummary({ ...fx(), weekStart: WEEK });
    expect(s.weekEnd).toBe('2026-11-28');
  });
});

describe('buildWeeklySummary', () => {
  it('counts sessions, sets and volume against the previous week', () => {
    const f = fx();
    session(f, '2026-11-16', { bench: [[60, 10], [60, 10]] });
    session(f, '2026-11-23', { bench: [[60, 10], [60, 10], [60, 9]] });
    session(f, '2026-11-26', { row: [[50, 10]] }, { row: 'גב' });
    session(f, '2026-11-29', { bench: [[100, 1]] }); // next week — ignored
    const s = buildWeeklySummary({ ...f, weekStart: WEEK });
    expect(s.sessions).toBe(2);
    expect(s.prevSessions).toBe(1);
    expect(s.sets).toBe(4);
    expect(s.prevSets).toBe(2);
    expect(s.volume).toBe(60 * 29 + 500);
    expect(s.prevVolume).toBe(1200);
  });

  it('ignores drafts and incomplete sets', () => {
    const f = fx();
    session(f, '2026-11-23', { bench: [[60, 10]] }, {}, 'draft');
    session(f, '2026-11-24', { bench: [[60, 10]] });
    f.sets[f.sets.length - 1]!.completed = false;
    const s = buildWeeklySummary({ ...f, weekStart: WEEK });
    expect(s.sessions).toBe(1);
    expect(s.sets).toBe(0);
  });

  it('groups sets per muscle, most sets first, keeping last week alongside', () => {
    const f = fx();
    session(f, '2026-11-17', { curl: [[10, 10]] }, { curl: 'יד קדמית' });
    session(
      f,
      '2026-11-23',
      { bench: [[60, 10]], row: [[50, 10], [50, 10], [50, 10]] },
      { row: 'גב' },
    );
    const s = buildWeeklySummary({ ...f, weekStart: WEEK });
    expect(s.muscles.map((m) => m.name)).toEqual(['גב', 'חזה', 'יד קדמית']);
    expect(s.muscles[0]).toMatchObject({ sets: 3, volume: 1500, prevSets: 0 });
    expect(s.muscles[2]).toMatchObject({ sets: 0, prevSets: 1, prevVolume: 100 });
  });

  it('flags a heavier top weight as a weight PR', () => {
    const f = fx();
    session(f, '2026-11-10', { bench: [[60, 10], [60, 10], [60, 10]] });
    session(f, '2026-11-24', { bench: [[62.5, 8], [62.5, 8], [62.5, 7]] });
    const s = buildWeeklySummary({ ...f, weekStart: WEEK });
    expect(s.prs).toHaveLength(1);
    expect(s.prs[0]).toMatchObject({ exerciseId: 'bench', kind: 'weight', detail: '62.5 × 8/8/7' });
  });

  it('flags more reps at the same weight as a weight × reps PR', () => {
    const f = fx();
    session(f, '2026-11-10', { bench: [[60, 10], [60, 10], [60, 8]] });
    session(f, '2026-11-24', { bench: [[60, 10], [60, 10], [60, 10]] });
    const s = buildWeeklySummary({ ...f, weekStart: WEEK });
    expect(s.prs[0]?.kind).toBe('strength');
  });

  it('never calls a first-ever outing a PR', () => {
    const f = fx();
    session(f, '2026-11-24', { bench: [[100, 10]] });
    expect(buildWeeklySummary({ ...f, weekStart: WEEK }).prs).toEqual([]);
  });

  it('counts bodyweight rep records as rep PRs', () => {
    const f = fx();
    session(f, '2026-11-10', { pullup: [[0, 8], [0, 8]] });
    session(f, '2026-11-24', { pullup: [[0, 10], [0, 9]] });
    expect(buildWeeklySummary({ ...f, weekStart: WEEK }).prs[0]?.kind).toBe('reps');
  });

  it('lists a lift as stuck after 3 outings without improvement, closest to an increase first', () => {
    const f = fx();
    for (const d of ['2026-11-09', '2026-11-16', '2026-11-23']) {
      session(f, d, {
        bench: [[60, 10], [60, 10], [60, 9]], // 1 rep short
        squat: [[100, 6], [100, 6], [100, 6]], // 12 reps short
      });
    }
    const s = buildWeeklySummary({ ...f, weekStart: WEEK });
    expect(s.stuck.map((x) => x.exerciseId)).toEqual(['bench', 'squat']);
    expect(s.stuck[0]).toMatchObject({ outings: 3, repsToIncrease: 1 });
  });

  it('does not call a lift stuck when reps went up', () => {
    const f = fx();
    session(f, '2026-11-09', { bench: [[60, 8], [60, 8], [60, 8]] });
    session(f, '2026-11-16', { bench: [[60, 8], [60, 8], [60, 8]] });
    session(f, '2026-11-23', { bench: [[60, 9], [60, 8], [60, 8]] });
    expect(buildWeeklySummary({ ...f, weekStart: WEEK }).stuck).toEqual([]);
  });

  it('only judges lifts trained this week', () => {
    const f = fx();
    for (const d of ['2026-11-01', '2026-11-08', '2026-11-15']) {
      session(f, d, { bench: [[60, 8]] });
    }
    expect(buildWeeklySummary({ ...f, weekStart: WEEK }).stuck).toEqual([]);
  });

  it('measures strength change vs each lift’s previous outing', () => {
    const f = fx();
    session(f, '2026-11-16', { a: [[100, 10]], b: [[50, 10]] });
    session(f, '2026-11-24', { a: [[100, 10]] }); // a level, b skipped
    session(f, '2026-11-25', { b: [[55, 10]] }); // b +10 %
    const s = buildWeeklySummary({ ...f, weekStart: WEEK });
    expect(s.compared).toBe(2);
    expect(s.strengthChangePct).toBeCloseTo(4.9, 1); // sqrt(1.1) − 1
  });

  it('reports the body-weight change from the last weigh-in before the week', () => {
    const m = (date: string, w: number): BodyMeasurement => ({
      id: date,
      date,
      bodyWeight: w,
      createdAt: 0,
      updatedAt: 0,
    });
    const s = buildWeeklySummary({
      ...fx(),
      weekStart: WEEK,
      measurements: [m('2026-11-24', 81.2), m('2026-11-10', 82), m('2026-11-20', 81.9)],
    });
    expect(s.bodyWeightChange).toBe(-0.7);
  });

  it('renders shareable text', () => {
    const f = fx();
    session(f, '2026-11-10', { bench: [[60, 10]] });
    session(f, '2026-11-24', { bench: [[62.5, 10]] });
    const text = weeklySummaryText(buildWeeklySummary({ ...f, weekStart: WEEK }), '22–28 בנובמבר');
    expect(text).toContain('סיכום שבועי · 22–28 בנובמבר');
    expect(text).toContain('bench: 62.5 × 10 (משקל שיא)');
  });
});

describe('drop sets', () => {
  it('add volume but are not counted as sets', () => {
    const f = fx();
    session(f, '2026-11-23', { curl: [[20, 8], [10, 10]] }, { curl: 'יד קדמית' });
    f.sets[f.sets.length - 1]!.isDrop = true;
    const s = buildWeeklySummary({ ...f, weekStart: WEEK });
    expect(s.sets).toBe(1);
    expect(s.volume).toBe(260);
    expect(s.muscles[0]!.sets).toBe(1);
  });
});

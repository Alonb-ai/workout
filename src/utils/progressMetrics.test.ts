import { describe, it, expect } from 'vitest';
import type { ExerciseLog, Session, SetLog } from '@/types';
import {
  buildAnalysisPrompt,
  buildExerciseHistories,
  exerciseTrends,
  formatTopSets,
  indexChange,
  pointFromSets,
  repsToIncrease,
  sessionChanges,
  strengthIndex,
} from './progressMetrics';

// ─── tiny fixture builder ───────────────────────────────────────────────────

interface Fx {
  sessions: Session[];
  logs: ExerciseLog[];
  sets: SetLog[];
}

function fx(): Fx {
  return { sessions: [], logs: [], sets: [] };
}

let n = 0;
/** Add a completed session on `date` with the given exercises: id → [weight, reps][]. */
function session(f: Fx, date: string, exercises: Record<string, [number, number][]>): string {
  const id = `s${++n}`;
  f.sessions.push({
    id,
    workoutId: 'w',
    planId: 'p',
    workoutName: 'A',
    workoutCode: 'UA',
    date,
    startedAt: n,
    status: 'completed',
  } as Session);
  for (const [ex, rows] of Object.entries(exercises)) {
    const logId = `${id}-${ex}`;
    f.logs.push({
      id: logId,
      sessionId: id,
      exerciseId: ex,
      order: 0,
      exerciseName: ex,
      muscleGroupName: 'm',
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
  return id;
}

const hist = (f: Fx) => buildExerciseHistories(f.sessions, f.logs, f.sets);
const three = (w: number, a: number, b: number, c: number): [number, number][] => [
  [w, a],
  [w, b],
  [w, c],
];

// ─── tests ──────────────────────────────────────────────────────────────────

describe('pointFromSets', () => {
  const sess = { id: 's', date: '2026-01-01', startedAt: 0 };
  const log = {
    exerciseId: 'bench',
    exerciseName: 'Bench',
    muscleGroupName: 'Chest',
    targetRepsMin: 8,
    targetRepsMax: 10,
    targetSets: 3,
  };
  const s = (weight: number, reps: number, setNumber: number, completed = true) => ({
    weight,
    reps,
    setNumber,
    completed,
  });

  it('counts reps gained between sets at the same weight', () => {
    const a = pointFromSets(sess, log, [s(60, 10, 1), s(60, 10, 2), s(60, 8, 3)])!;
    const b = pointFromSets(sess, log, [s(60, 10, 1), s(60, 10, 2), s(60, 9, 3)])!;
    expect(b.measure).toBeGreaterThan(a.measure);
  });

  it('ignores warm-ups below the top weight and incomplete sets', () => {
    const p = pointFromSets(sess, log, [s(40, 12, 1), s(60, 8, 2), s(60, 7, 3), s(60, 9, 4, false)])!;
    expect(p.topWeight).toBe(60);
    expect(p.topReps).toEqual([8, 7]);
  });

  it('treats a weight jump that costs two reps as roughly level', () => {
    const before = pointFromSets(sess, log, [s(60, 10, 1), s(60, 10, 2), s(60, 10, 3)])!;
    const after = pointFromSets(sess, log, [s(62.5, 8, 1), s(62.5, 8, 2), s(62.5, 8, 3)])!;
    expect(Math.abs(after.measure / before.measure - 1)).toBeLessThan(0.02);
  });

  it('measures bodyweight work in reps', () => {
    const p = pointFromSets(sess, log, [s(0, 12, 1), s(0, 10, 2)])!;
    expect(p.kind).toBe('reps');
    expect(p.measure).toBe(11);
  });

  it('returns null when nothing was completed', () => {
    expect(pointFromSets(sess, log, [s(60, 8, 1, false)])).toBeNull();
  });
});

describe('strengthIndex', () => {
  it('does not move when an exercise is skipped', () => {
    const f = fx();
    session(f, '2026-01-01', { bench: three(60, 8, 8, 8), row: three(50, 8, 8, 8) });
    session(f, '2026-01-08', { bench: three(60, 8, 8, 8), row: three(50, 8, 8, 8) });
    // Row skipped: the 0–100 score would drop on completion; the index must not.
    session(f, '2026-01-15', { bench: three(60, 8, 8, 8) });
    const series = strengthIndex(hist(f), f.sessions);
    expect(series.map((p) => p.index)).toEqual([100, 100, 100]);
  });

  it('a new exercise starts level and does not drag the index', () => {
    const f = fx();
    session(f, '2026-01-01', { bench: three(60, 8, 8, 8) });
    session(f, '2026-01-08', { bench: three(60, 8, 8, 8), curl: three(10, 8, 8, 8) });
    expect(strengthIndex(hist(f), f.sessions).at(-1)!.index).toBe(100);
  });

  it('telescopes: alternating up/down lands back where it started', () => {
    const f = fx();
    session(f, '2026-01-01', { bench: three(60, 8, 8, 8) });
    session(f, '2026-01-08', { bench: three(60, 10, 10, 10), a: three(1, 8, 8, 8), b: three(1, 8, 8, 8) });
    session(f, '2026-01-15', { bench: three(60, 8, 8, 8) });
    expect(strengthIndex(hist(f), f.sessions).at(-1)!.index).toBe(100);
  });

  it('measures the window from the last outing before it', () => {
    const f = fx();
    session(f, '2026-01-01', { bench: three(60, 8, 8, 8) });
    session(f, '2026-03-01', { bench: three(60, 10, 10, 10) });
    const series = strengthIndex(hist(f), f.sessions, '2026-02-01');
    expect(series).toHaveLength(1);
    expect(indexChange(series)).toBeGreaterThan(4);
  });

  it('sessionChanges compares each exercise only with its own previous outing', () => {
    const f = fx();
    session(f, '2026-01-01', { bench: three(60, 8, 8, 8) });
    const id = session(f, '2026-01-08', { bench: three(60, 8, 8, 8), curl: three(10, 8, 8, 8) });
    const c = sessionChanges(hist(f)).get(id)!;
    expect(c.compared).toBe(1);
    expect(c.changePct).toBe(0);
  });
});

describe('exerciseTrends', () => {
  it('flags a lift that went up, one that went down, and a new one', () => {
    const f = fx();
    session(f, '2026-01-01', { bench: three(60, 8, 8, 8), squat: three(80, 8, 8, 8) });
    session(f, '2026-01-08', {
      bench: three(62.5, 9, 9, 9),
      squat: three(80, 6, 6, 6),
      curl: three(10, 8, 8, 8),
    });
    const t = new Map(exerciseTrends(hist(f), null).map((x) => [x.exerciseId, x]));
    expect(t.get('bench')!.status).toBe('up');
    expect(t.get('squat')!.status).toBe('down');
    expect(t.get('curl')!.status).toBe('new');
  });

  it('repsToIncrease is the gap to the top of the range across target sets', () => {
    const f = fx();
    session(f, '2026-01-01', { bench: three(60, 10, 10, 9) });
    const p = hist(f).get('bench')![0]!;
    expect(repsToIncrease(p)).toBe(1);
    expect(formatTopSets(p)).toBe('60 × 10/10/9');
  });
});

describe('buildAnalysisPrompt', () => {
  it('lists each exercise with its sets and asks for next-session advice', () => {
    const f = fx();
    session(f, '2026-01-01', { bench: three(60, 8, 8, 8) });
    session(f, '2026-01-08', { bench: three(62.5, 8, 7, 7) });
    const h = hist(f);
    const text = buildAnalysisPrompt(h, strengthIndex(h, f.sessions), {
      today: '2026-01-10',
      since: '2026-01-01',
    });
    expect(text).toContain('bench (m) [3×8–10]');
    expect(text).toContain('2026-01-08: 62.5 × 8/7/7');
    expect(text).toContain('התקדמות כפולה');
  });
});

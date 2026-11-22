import { describe, expect, it } from 'vitest';
import { isDraftStale, planUnsavedWorkoutReminders } from './unsavedWorkoutPlan';
import type { DraftExercise, WorkoutDraft } from './types';

const H = 3_600_000;
const NOW = new Date(2026, 10, 22, 20, 0, 0);

function ex(completed: boolean[]): DraftExercise {
  return {
    exerciseId: 'e1',
    exerciseName: 'לחיצת חזה',
    muscleGroupId: 'm1',
    muscleGroupName: 'חזה',
    targetSets: completed.length,
    targetRepsMin: 6,
    targetRepsMax: 8,
    barWeight: 20,
    isMachine: false,
    defaultRestSec: 120,
    order: 0,
    sets: completed.map((c, i) => ({ setNumber: i + 1, weight: 60, reps: 8, completed: c })),
  };
}

function draft(over: Partial<WorkoutDraft>): WorkoutDraft {
  return {
    workoutId: 'w1',
    planId: 'p1',
    workoutName: 'עליון A',
    workoutCode: 'UA',
    drafts: [ex([true, true, false])],
    sessionDate: '2026-11-22',
    notes: '',
    startedAt: NOW.getTime() - H,
    updatedAt: NOW.getTime(),
    ...over,
  };
}

describe('planUnsavedWorkoutReminders', () => {
  it('nudges 2h and 12h after the last change', () => {
    const plan = planUnsavedWorkoutReminders({ now: NOW, drafts: [draft({})] });
    expect(plan.map((r) => r.at.getTime() - NOW.getTime())).toEqual([2 * H, 12 * H]);
    expect(plan[0]?.body).toContain('2 סטים');
    expect(plan[0]?.url).toBe('/');
  });

  it('ignores drafts with nothing completed', () => {
    const plan = planUnsavedWorkoutReminders({
      now: NOW,
      drafts: [draft({ drafts: [ex([false, false])] })],
    });
    expect(plan).toEqual([]);
  });

  it('drops reminders already in the past, keeps later ones', () => {
    const plan = planUnsavedWorkoutReminders({
      now: NOW,
      drafts: [draft({ updatedAt: NOW.getTime() - 3 * H })],
    });
    expect(plan).toHaveLength(1);
    expect(plan[0]?.at.getTime()).toBe(NOW.getTime() + 9 * H);
  });

  it('caps and sorts across several drafts', () => {
    const drafts = Array.from({ length: 5 }, (_, i) =>
      draft({ workoutId: `w${i}`, updatedAt: NOW.getTime() - i * 60_000 }),
    );
    const plan = planUnsavedWorkoutReminders({ now: NOW, drafts });
    expect(plan).toHaveLength(6);
    const times = plan.map((r) => r.at.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(new Set(plan.map((r) => r.key)).size).toBe(6);
  });

  it('uses singular for one set', () => {
    const plan = planUnsavedWorkoutReminders({
      now: NOW,
      drafts: [draft({ drafts: [ex([true, false])] })],
    });
    expect(plan[0]?.body).toContain('סט עוד');
  });
});

describe('isDraftStale', () => {
  it('is stale after 2h of silence with logged sets', () => {
    expect(isDraftStale(draft({ updatedAt: NOW.getTime() - 2 * H }), NOW.getTime())).toBe(true);
    expect(isDraftStale(draft({ updatedAt: NOW.getTime() - H }), NOW.getTime())).toBe(false);
  });
  it('never stale without completed sets', () => {
    expect(
      isDraftStale(draft({ drafts: [ex([false])], updatedAt: 0 }), NOW.getTime()),
    ).toBe(false);
  });
});

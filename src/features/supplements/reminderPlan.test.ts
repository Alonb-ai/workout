import { describe, expect, it } from 'vitest';
import { planReminders } from './reminderPlan';
import type { Supplement } from '@/types';

function sup(over: Partial<Supplement>): Supplement {
  return {
    id: 's1',
    name: 'קריאטין',
    dose: 5,
    unit: 'g',
    color: '#fff',
    withFood: false,
    daysOfWeek: [],
    times: ['08:00'],
    active: true,
    order: 0,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

// Sunday 22 Nov 2026, 10:00 local.
const NOW = new Date(2026, 10, 22, 10, 0, 0);

describe('planReminders', () => {
  it('skips times already past today and starts tomorrow', () => {
    const plan = planReminders({ now: NOW, supplements: [sup({})], logs: [], body: null, horizonDays: 3 });
    expect(plan.map((r) => r.key)).toEqual(['s1|2026-11-23|08:00', 's1|2026-11-24|08:00']);
    expect(plan[0]?.at.getHours()).toBe(8);
  });

  it('leaves out a dose already logged', () => {
    const plan = planReminders({
      now: NOW,
      supplements: [sup({ times: ['20:00'] })],
      logs: [{ supplementId: 's1', date: '2026-11-22', scheduledTime: '20:00' }],
      body: null,
      horizonDays: 2,
    });
    expect(plan.map((r) => r.key)).toEqual(['s1|2026-11-23|20:00']);
  });

  it('honours daysOfWeek (0 = Sunday) and ignores inactive supplements', () => {
    const plan = planReminders({
      now: NOW,
      supplements: [sup({ daysOfWeek: [1], times: ['09:00'] }), sup({ id: 's2', active: false, times: ['11:00'] })],
      logs: [],
      body: null,
      horizonDays: 7,
    });
    expect(plan.map((r) => r.key)).toEqual(['s1|2026-11-23|09:00']);
  });

  it('caps the list at the earliest `max` reminders, sorted by time', () => {
    const plan = planReminders({
      now: NOW,
      supplements: [sup({ times: ['21:00', '07:00', '13:00'] })],
      logs: [],
      body: null,
      max: 4,
    });
    expect(plan).toHaveLength(4);
    expect(plan.map((r) => r.key)).toEqual([
      's1|2026-11-22|13:00',
      's1|2026-11-22|21:00',
      's1|2026-11-23|07:00',
      's1|2026-11-23|13:00',
    ]);
  });

  it('schedules the weekly body reminder, skipping today once a measurement exists', () => {
    const body = { enabled: true, dow: 0, time: '18:00', loggedToday: true };
    const plan = planReminders({ now: NOW, supplements: [], logs: [], body, horizonDays: 8 });
    expect(plan.map((r) => r.key)).toEqual(['body|2026-11-29|18:00']);
    expect(plan[0]?.url).toBe('#/body');
  });

  it('ignores malformed times', () => {
    const plan = planReminders({ now: NOW, supplements: [sup({ times: ['25:00', 'x'] })], logs: [], body: null });
    expect(plan).toEqual([]);
  });
});

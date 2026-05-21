import { create } from 'zustand';

/**
 * Lightweight, global rest timer. Only one timer runs at a time
 * (we restart it on each completed set).
 *
 * `endsAt` is a real-clock timestamp so the countdown survives tab visibility
 * changes / app suspension up to the OS limit.
 */
interface TimerState {
  endsAt: number | null;
  totalSec: number; // configured duration
  label: string;
  running: boolean;
  start: (sec: number, label?: string) => void;
  add: (deltaSec: number) => void;
  stop: () => void;
  /** snapshot remaining seconds (call from a tick loop / setInterval). */
  remaining: () => number;
}

export const useTimerStore = create<TimerState>((set, get) => ({
  endsAt: null,
  totalSec: 0,
  label: '',
  running: false,
  start: (sec: number, label = '') => {
    const endsAt = Date.now() + sec * 1000;
    set({ endsAt, totalSec: sec, label, running: true });
  },
  add: (deltaSec: number) => {
    const cur = get().endsAt;
    if (!cur) return;
    const nextEndsAt = Math.max(Date.now(), cur + deltaSec * 1000);
    set({ endsAt: nextEndsAt, totalSec: get().totalSec + deltaSec });
  },
  stop: () => set({ endsAt: null, running: false, label: '' }),
  remaining: () => {
    const e = get().endsAt;
    if (!e) return 0;
    return Math.max(0, Math.ceil((e - Date.now()) / 1000));
  },
}));

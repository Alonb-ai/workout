import { useTimerStore } from '@/store/timer';
import { useTick } from '@/hooks/useTick';
import { formatHM } from '@/utils/dates';
import { IconClock, IconPlus, IconMinus, IconX } from '@/components/Icon';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef } from 'react';
import { useSettings } from '@/hooks/useSettings';

type AudioCtor = typeof AudioContext;
interface WindowWithWebkit extends Window {
  webkitAudioContext?: AudioCtor;
}

/**
 * Schedule the two end-of-rest beeps at an absolute future audio time.
 * Using AudioContext absolute scheduling means the beeps fire even when the
 * main thread is throttled (background tab on desktop). On iOS in another app
 * the AudioContext gets suspended and won't fire — this is a browser limit.
 */
function scheduleBeeps(msFromNow: number): {
  ctx: AudioContext;
  oscs: OscillatorNode[];
} | null {
  try {
    const Ctor: AudioCtor | undefined =
      window.AudioContext ?? (window as WindowWithWebkit).webkitAudioContext;
    if (!Ctor) return null;
    const ctx = new Ctor();
    const start = ctx.currentTime + Math.max(0, msFromNow / 1000);
    const oscs: OscillatorNode[] = [];
    const playPulse = (at: number, freq: number) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.2, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);
      o.connect(g);
      g.connect(ctx.destination);
      o.start(at);
      o.stop(at + 0.14);
      oscs.push(o);
    };
    playPulse(start, 880);
    playPulse(start + 0.18, 988); // slight upward chirp = clearly two beeps
    return { ctx, oscs };
  } catch {
    return null;
  }
}

/** Global, persistent rest timer banner pinned above the bottom nav. */
export function GlobalRestTimerBar() {
  const endsAt = useTimerStore((s) => s.endsAt);
  const totalSec = useTimerStore((s) => s.totalSec);
  const label = useTimerStore((s) => s.label);
  const add = useTimerStore((s) => s.add);
  const stop = useTimerStore((s) => s.stop);
  const settings = useSettings();
  const scheduledRef = useRef<{ ctx: AudioContext; oscs: OscillatorNode[] } | null>(null);
  const notifyTimeoutRef = useRef<number | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const vibrateTimeoutRef = useRef<number | null>(null);
  useTick(500);

  const remaining = endsAt ? Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)) : 0;
  const pct = totalSec > 0 ? Math.max(0, Math.min(1, 1 - remaining / totalSec)) : 0;

  // Schedule beeps + notification + wake lock when the timer is (re)set.
  useEffect(() => {
    const cancel = () => {
      if (scheduledRef.current) {
        for (const o of scheduledRef.current.oscs) {
          try {
            o.stop();
          } catch {
            /* already stopped */
          }
        }
        scheduledRef.current.ctx.close().catch(() => {});
        scheduledRef.current = null;
      }
      if (notifyTimeoutRef.current !== null) {
        window.clearTimeout(notifyTimeoutRef.current);
        notifyTimeoutRef.current = null;
      }
      if (vibrateTimeoutRef.current !== null) {
        window.clearTimeout(vibrateTimeoutRef.current);
        vibrateTimeoutRef.current = null;
      }
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
    };

    if (!endsAt) {
      cancel();
      return;
    }

    const msUntilEnd = endsAt - Date.now();

    if (settings.restTimerSound && msUntilEnd > 0) {
      scheduledRef.current = scheduleBeeps(msUntilEnd);
    }

    // Best-effort backup: a setTimeout-driven vibration + SW notification.
    // On mobile background this may fire late or not at all, but on desktop /
    // foreground it gives a second sensory cue alongside the audio.
    notifyTimeoutRef.current = window.setTimeout(() => {
      notifyTimeoutRef.current = null;
      if ('vibrate' in navigator) {
        navigator.vibrate?.([80, 60, 80]);
      }
      if (
        typeof Notification !== 'undefined' &&
        Notification.permission === 'granted' &&
        'serviceWorker' in navigator
      ) {
        navigator.serviceWorker.ready
          .then((reg) =>
            reg.showNotification('הזמן נגמר', {
              body: label ? `סיום מנוחה · ${label}` : 'סיום מנוחה — הסט הבא 💪',
              tag: 'iron-track-rest',
              silent: false,
              icon: '/icons/icon-192.png',
              badge: '/icons/icon-192.png',
            }),
          )
          .catch(() => {});
      }
    }, Math.max(0, msUntilEnd));

    // Keep the screen on while the rest timer is counting down. The user is
    // mid-workout and likely glancing at the phone between sets.
    if ('wakeLock' in navigator && document.visibilityState === 'visible') {
      navigator.wakeLock
        .request('screen')
        .then((lock) => {
          wakeLockRef.current = lock;
        })
        .catch(() => {});
    }

    return cancel;
  }, [endsAt, settings.restTimerSound, label]);

  return (
    <AnimatePresence>
      {endsAt && (
        <motion.div
          initial={{ y: 60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 60, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 32 }}
          className="fixed left-0 right-0 z-30 pointer-events-none"
          style={{ bottom: 'calc(60px + env(safe-area-inset-bottom))' }}
        >
          <div className="max-w-2xl mx-auto px-3">
            <div
              className={`pointer-events-auto bg-ink-800/95 backdrop-blur border ${
                remaining === 0 ? 'border-good' : 'border-line'
              } rounded-2xl shadow-card overflow-hidden`}
            >
              <div className="px-3 py-2.5 flex items-center gap-3">
                <span
                  className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                    remaining === 0 ? 'bg-good text-ink-950' : 'bg-accent text-ink-950'
                  }`}
                >
                  <IconClock />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-2xs text-fg-muted">
                    {remaining === 0 ? 'מנוחה הסתיימה' : label || 'מנוחה'}
                  </p>
                  <p className="num text-xl font-bold">{formatHM(remaining)}</p>
                </div>
                <button
                  className="btn-icon !min-w-9 !min-h-9 bg-ink-700"
                  aria-label="הוסף 15 שניות"
                  onClick={() => add(15)}
                >
                  <IconPlus size={18} />
                </button>
                <button
                  className="btn-icon !min-w-9 !min-h-9 bg-ink-700"
                  aria-label="הפחת 15 שניות"
                  onClick={() => add(-15)}
                >
                  <IconMinus size={18} />
                </button>
                <button
                  className="btn-icon !min-w-9 !min-h-9 bg-ink-700"
                  aria-label="דלג"
                  onClick={() => stop()}
                >
                  <IconX size={18} />
                </button>
              </div>
              <div className="h-1 bg-ink-900">
                <div
                  className={`h-full transition-[width] duration-500 ${
                    remaining === 0 ? 'bg-good' : 'bg-accent'
                  }`}
                  style={{ width: `${pct * 100}%` }}
                />
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

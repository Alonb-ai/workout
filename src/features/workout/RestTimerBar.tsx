import { useTimerStore } from '@/store/timer';
import { useTick } from '@/hooks/useTick';
import { formatHM } from '@/utils/dates';
import { IconPlus, IconMinus, IconX } from '@/components/Icon';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef } from 'react';
import { useSettings } from '@/hooks/useSettings';
import { cn } from '@/utils/cn';

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
    if (!Ctor) {
      console.warn('Rest timer audio: AudioContext not available');
      return null;
    }
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
  } catch (err) {
    console.warn('Rest timer audio scheduling failed:', err);
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

    // Vibration at end as a second cue. No SW notification — per user request
    // the timer should only nudge while the app is in the foreground.
    vibrateTimeoutRef.current = window.setTimeout(() => {
      vibrateTimeoutRef.current = null;
      if ('vibrate' in navigator) {
        navigator.vibrate?.([80, 60, 80]);
      }
      // The store keeps `endsAt` set after the countdown ends (the bar stays up
      // showing 0:00), so this effect never re-runs — release the screen lock
      // here or it stays held until the user leaves the screen entirely.
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
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
  }, [endsAt, settings.restTimerSound]);

  const done = remaining === 0;

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
            {/* Read from two metres away, between sets: the remaining time is the
                whole message, so it is set as a display figure and everything
                else — label, controls, groove — recedes around it.
                The three controls stay direct children of this row: an E2E spec
                identifies the bar as the innermost div holding the skip button
                and asserts the lift name and clock read inside it. */}
            <div
              className={cn(
                'pointer-events-auto card overflow-hidden bg-ink-850/95 backdrop-blur shadow-raised',
                done && 'border-good/50',
              )}
            >
              <div className="ps-4 pe-2 py-1.5 flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <p className={cn('eyebrow truncate', done && 'text-good')}>
                    {done ? 'מנוחה הסתיימה' : label || 'מנוחה'}
                  </p>
                  <p
                    className={cn(
                      'num-display text-[2.5rem] leading-none mt-0.5',
                      done ? 'text-good' : 'text-fg',
                    )}
                  >
                    {formatHM(remaining)}
                  </p>
                </div>
                <button
                  className="btn-icon bg-ink-800 border border-line text-fg"
                  aria-label="הוסף 15 שניות"
                  onClick={() => add(15)}
                >
                  <IconPlus size={20} />
                </button>
                <button
                  className="btn-icon bg-ink-800 border border-line text-fg"
                  aria-label="הפחת 15 שניות"
                  onClick={() => add(-15)}
                >
                  <IconMinus size={20} />
                </button>
                <button
                  className="btn-icon bg-ink-800 border border-line text-fg-muted"
                  aria-label="דלג"
                  onClick={() => stop()}
                >
                  <IconX size={20} />
                </button>
              </div>
              {/* A carved rail along the bottom edge of the bar. Full-bleed
                  rather than inset: the whole bar has to stay under 80px so it
                  never covers content that `.pb-tabbar-timer` already paid for. */}
              <div className="h-1.5 bg-ink-950 shadow-field">
                <div
                  className={cn(
                    'h-full rounded-e-full transition-[width] duration-500',
                    done ? 'bg-good' : 'bg-accent',
                  )}
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

import { registerPlugin } from '@capacitor/core';

/**
 * Bridge to the app's own native plugin (`ios/App/App/RestTimerPlugin.swift`),
 * which drives the rest-timer Live Activity: the countdown on the lock screen
 * and in the Dynamic Island. The countdown itself is rendered by iOS from the
 * end time (`Text(timerInterval:)`), so it keeps ticking while the app is
 * suspended — no background work, no push server.
 *
 * Requires iOS 16.2+ and Live Activities allowed for the app in iOS Settings;
 * on anything older every call resolves `{ started: false }`.
 */
export interface RestTimerPlugin {
  start(options: {
    /** Epoch ms when the rest ends. */
    endsAt: number;
    /** Epoch ms when the rest started (for the progress bar). */
    startedAt: number;
    /** What the rest is for, e.g. the exercise name. */
    label: string;
  }): Promise<{ started: boolean }>;
  end(): Promise<void>;
}

export const RestTimerNative = registerPlugin<RestTimerPlugin>('RestTimer');

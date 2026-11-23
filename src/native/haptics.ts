import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { isNativeApp } from './platform';

/**
 * A tap you can feel. Logging a set mid-workout happens with sweaty hands and
 * eyes elsewhere; a tick through the phone confirms it without looking back.
 *
 * iOS app: the Taptic Engine via @capacitor/haptics. Browser: `navigator.vibrate`
 * where it exists (Android; iOS Safari has none, so the PWA stays silent).
 * Never throws — a missing haptic must not break the tap that asked for it.
 */
export function hapticTap(kind: 'light' | 'success' = 'light'): void {
  try {
    if (isNativeApp()) {
      const p =
        kind === 'success'
          ? Haptics.notification({ type: NotificationType.Success })
          : Haptics.impact({ style: ImpactStyle.Light });
      void p.catch(() => {});
      return;
    }
    navigator.vibrate?.(kind === 'success' ? [12, 40, 12] : 10);
  } catch {
    /* no haptics on this device */
  }
}

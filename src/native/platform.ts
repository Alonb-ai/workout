import { Capacitor } from '@capacitor/core';

/**
 * True inside the Capacitor iOS shell, false in any browser (including the
 * installed home-screen PWA). Everything native-only is gated on this, so the
 * web build and the E2E suite behave exactly as before.
 */
export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

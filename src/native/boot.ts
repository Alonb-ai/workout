import { StatusBar, Style } from '@capacitor/status-bar';

/** One-time native shell setup. Safe to call before React mounts. */
export function bootNativeShell(): void {
  // Light status-bar text over the app's near-black background.
  StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
}

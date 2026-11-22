import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Native iOS shell (Capacitor). The web build in `dist/` is copied into the
 * Xcode project by `npx cap sync ios`; nothing here talks to a server.
 *
 * NOTE: the native app runs on its own origin (capacitor://localhost), so its
 * IndexedDB is NOT the home-screen PWA's. Data moves only via Settings →
 * export (old app) → import (new app).
 */
const config: CapacitorConfig = {
  appId: 'com.alonb.irontrack',
  appName: 'Iron Track',
  webDir: 'dist',
  backgroundColor: '#0b0d10',
  ios: {
    // Web content goes edge-to-edge; the app already pads with
    // env(safe-area-inset-*) (viewport-fit=cover in index.html).
    contentInset: 'never',
    backgroundColor: '#0b0d10',
    limitsNavigationsToAppBoundDomains: false,
  },
  plugins: {
    LocalNotifications: {
      iconColor: '#ff8a2a',
    },
  },
};

export default config;

import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Standalone config — the app's vite.config.ts pulls in the PWA plugin, which
// has nothing to do with unit tests.
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // fake-indexeddb gives the Dexie tests a real IndexedDB implementation.
    setupFiles: ['src/test/setup.ts'],
  },
});

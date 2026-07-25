import { defineConfig, devices } from '@playwright/test';

/**
 * E2E covers the flows that only a real browser can prove: IndexedDB survives a
 * reload, the service worker doesn't eat state, and the one-tap logging path
 * works with a real touch viewport. Everything else is a vitest unit test.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // one shared dev server, one IndexedDB per worker
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 30_000,
  use: {
    ...devices['iPhone 13'],
    baseURL: 'http://localhost:5173',
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});

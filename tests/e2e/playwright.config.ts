import { defineConfig } from '@playwright/test';

// L4: the built extension in Playwright's Chromium, on the real YouTube,
// signed in with the profile `npm run e2e:login` prepared. One worker: there
// is one account and the lists are shared.
export default defineConfig({
  testDir: '.',
  globalSetup: './support/global-setup.ts',
  outputDir: './.out/results',
  workers: 1,
  fullyParallel: false,
  // One retry: a test that passes only on it is reported flaky, not failed (D-022).
  retries: 1,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: [['list'], ['html', { outputFolder: './.out/report', open: 'never' }]],
  projects: [
    { name: 'e2e', testMatch: 'specs/**/*.spec.ts' },
    { name: 'cleanup', testMatch: 'tools/cleanup.spec.ts' },
  ],
});

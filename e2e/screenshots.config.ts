import { defineConfig, devices } from '@playwright/test';

/**
 * Captures the README screenshots (docs/images) from a running, seeded stack. Not part
 * of the test suite:
 *
 *   docker compose --profile app up -d --build --wait
 *   docker compose run --rm seed
 *   pnpm --filter @sitesentinel/e2e screenshots
 */
export default defineConfig({
  testDir: './screenshots',
  globalSetup: './screenshots/sign-in.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: process.env.SCREENSHOT_BASE_URL ?? 'http://localhost:8080',
    testIdAttribute: 'data-test',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
});

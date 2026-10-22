import { defineConfig, devices } from '@playwright/test';
import { E2E, serverEnv } from './support/env.js';

const isCI = Boolean(process.env.CI);

/**
 * Runs against the built apps (`pnpm build`) and the docker-compose services
 * (Mongo, Redis, Mailpit). The servers are always started fresh by Playwright,
 * never reused, so they are guaranteed to run with SIMULATED_NETWORK=true.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: isCI ? 2 : undefined,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  globalSetup: './support/global-setup.ts',
  use: {
    baseURL: E2E.webUrl,
    testIdAttribute: 'data-test',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      name: 'api',
      command: 'node dist/main.js',
      cwd: '../apps/api',
      url: `http://localhost:${E2E.apiPort}/api/v1/health/ready`,
      env: { ...serverEnv, API_PORT: String(E2E.apiPort) },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      name: 'worker',
      command: 'node dist/main.js',
      cwd: '../apps/worker',
      url: `http://localhost:${E2E.workerMetricsPort}/health/live`,
      env: { ...serverEnv, WORKER_METRICS_PORT: String(E2E.workerMetricsPort) },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      name: 'web',
      command: `pnpm exec vite preview --port ${E2E.webPort} --strictPort`,
      cwd: '../apps/web',
      url: E2E.webUrl,
      env: { VITE_API_PROXY_TARGET: `http://localhost:${E2E.apiPort}` },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});

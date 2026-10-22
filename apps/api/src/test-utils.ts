import { systemClock } from '@sitesentinel/checks';
import { pino } from 'pino';
import { createApp, type AppDeps } from './app.js';
import { createPasswordHasher } from './auth/passwords.js';
import { CSRF_HEADER } from './http/csrf.js';
import { memoryRateLimitStores } from './http/rate-limits.js';
import { MemoryAlertEnqueuer } from './infra/alert-queue.js';
import { MemoryCheckEnqueuer } from './infra/check-queue.js';
import { MemoryMailer } from './mail/mailer.js';

export const silentLogger = pino({ level: 'silent' });

export const TEST_WEB_ORIGIN = 'http://localhost:5173';

/** Header every mutating test request needs (see http/csrf.ts). */
export const CSRF = { [CSRF_HEADER]: 'XMLHttpRequest' };

/** Cheap argon2id parameters: tests exercise the logic, not the cost. */
export const fastPasswords = createPasswordHasher({
  memoryCost: 1_024,
  timeCost: 1,
  parallelism: 1,
});

export const TEST_AUTH_CONFIG: AppDeps['config']['auth'] = {
  jwtSecret: 'test-secret-that-is-at-least-32-characters-long',
  accessTokenTtlSeconds: 900,
  refreshTokenTtlDays: 30,
  passwordResetTtlMinutes: 60,
  cookieSecure: false,
};

/** Encrypts webhook secrets in tests; decrypt with the same key to assert on them. */
export const TEST_ALERT_SECRET_KEY = Buffer.alloc(32, 7);

/** An app wired with harmless defaults; override only what a test cares about. */
export function buildTestApp(overrides: Partial<AppDeps> = {}) {
  return createApp({
    config: {
      webOrigin: TEST_WEB_ORIGIN,
      bodyLimit: '1kb',
      readinessTimeoutMs: 200,
      trustProxy: 0,
      auth: TEST_AUTH_CONFIG,
      alertSecretKey: TEST_ALERT_SECRET_KEY,
    },
    logger: silentLogger,
    readinessProbes: { mongo: async () => undefined, redis: async () => undefined },
    version: '0.0.0-test',
    mailer: new MemoryMailer(),
    passwords: fastPasswords,
    rateLimitStores: memoryRateLimitStores,
    verifyOwnership: async () => ({ verified: false, method: null, attempts: [] }),
    checks: new MemoryCheckEnqueuer(),
    alerts: new MemoryAlertEnqueuer(),
    clock: systemClock,
    ...overrides,
  });
}

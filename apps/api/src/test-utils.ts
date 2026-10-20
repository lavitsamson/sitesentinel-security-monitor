import { pino } from 'pino';
import { createApp, type AppDeps } from './app.js';

export const silentLogger = pino({ level: 'silent' });

export const TEST_WEB_ORIGIN = 'http://localhost:5173';

/** An app wired with harmless defaults; override only what a test cares about. */
export function buildTestApp(overrides: Partial<AppDeps> = {}) {
  return createApp({
    config: { webOrigin: TEST_WEB_ORIGIN, bodyLimit: '1kb', readinessTimeoutMs: 200 },
    logger: silentLogger,
    readinessProbes: { mongo: async () => undefined, redis: async () => undefined },
    version: '0.0.0-test',
    ...overrides,
  });
}

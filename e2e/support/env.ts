/**
 * Where the suite runs. Ports differ from `pnpm dev` (4000/5173) so a dev stack
 * can stay up, and the data lives in its own Mongo database and Redis db index.
 */
export const E2E = {
  apiPort: 4100,
  webPort: 5174,
  workerMetricsPort: 9564,
  webUrl: 'http://localhost:5174',
  mongoUrl: process.env.E2E_MONGO_URL ?? 'mongodb://localhost:27017/sitesentinel_e2e',
  redisUrl: process.env.E2E_REDIS_URL ?? 'redis://localhost:6379/1',
  mailpitUrl: process.env.E2E_MAILPIT_URL ?? 'http://localhost:8025',
} as const;

/** Environment shared by the API and the worker under test. Dev-only secrets. */
export const serverEnv: Record<string, string> = {
  NODE_ENV: 'test',
  LOG_LEVEL: process.env.E2E_LOG_LEVEL ?? 'warn',
  MONGO_URL: E2E.mongoUrl,
  REDIS_URL: E2E.redisUrl,
  WEB_ORIGIN: E2E.webUrl,
  SMTP_URL: process.env.E2E_SMTP_URL ?? 'smtp://localhost:1025',
  JWT_ACCESS_SECRET: 'e2e-only-access-secret-0123456789abcdef',
  ALERT_SECRET_KEY: Buffer.alloc(32, 'e2e').toString('base64'),
  // Never contact a real domain: answers come from the simulated network in Redis.
  SIMULATED_NETWORK: 'true',
};

export const PASSWORD = 'correct horse battery staple';

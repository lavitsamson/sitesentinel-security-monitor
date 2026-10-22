import { parseSecretKey } from '@sitesentinel/shared/node';
import { z } from 'zod';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  MONGO_URL: z.string().regex(/^mongodb(\+srv)?:\/\//, 'must be a mongodb:// URL'),
  REDIS_URL: z.string().regex(/^rediss?:\/\//, 'must be a redis:// URL'),
  /** Jobs processed in parallel per worker process. */
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(5),
  /** How long SIGTERM waits for in-flight jobs before forcing exit. */
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  /** Base of links in emails the worker sends. */
  WEB_ORIGIN: z.url().default('http://localhost:5173'),
  SMTP_URL: z
    .string()
    .regex(/^smtps?:\/\//, 'must be an smtp:// URL')
    .default('smtp://localhost:1025'),
  MAIL_FROM: z.string().min(3).default('SiteSentinel <no-reply@sitesentinel.local>'),
  /** Decrypts webhook signing secrets; must match the API's. */
  ALERT_SECRET_KEY: z.string().transform((value, ctx) => {
    try {
      return parseSecretKey(value);
    } catch (err) {
      ctx.addIssue({ code: 'custom', message: (err as Error).message });
      return z.NEVER;
    }
  }),
  /** Port of the worker's /metrics and /health/live server; 0 turns it off. */
  WORKER_METRICS_PORT: z.coerce.number().int().min(0).max(65_535).default(9464),
  /** When set, GET /metrics requires `Authorization: Bearer <token>`. */
  METRICS_TOKEN: z.string().min(16, 'must be at least 16 characters').optional(),
});

export interface Config {
  env: 'development' | 'test' | 'production';
  logLevel: (typeof LOG_LEVELS)[number];
  mongoUrl: string;
  redisUrl: string;
  concurrency: number;
  shutdownTimeoutMs: number;
  webOrigin: string;
  smtpUrl: string;
  mailFrom: string;
  alertSecretKey: Buffer;
  /** null when the metrics server is turned off. */
  metricsPort: number | null;
  metricsToken: string | null;
}

/** Parses and validates environment variables, failing fast with every problem listed. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid worker configuration:\n${issues.join('\n')}`);
  }
  const e = parsed.data;
  return {
    env: e.NODE_ENV,
    logLevel: e.LOG_LEVEL,
    mongoUrl: e.MONGO_URL,
    redisUrl: e.REDIS_URL,
    concurrency: e.WORKER_CONCURRENCY,
    shutdownTimeoutMs: e.SHUTDOWN_TIMEOUT_MS,
    webOrigin: e.WEB_ORIGIN,
    smtpUrl: e.SMTP_URL,
    mailFrom: e.MAIL_FROM,
    alertSecretKey: e.ALERT_SECRET_KEY,
    metricsPort: e.WORKER_METRICS_PORT === 0 ? null : e.WORKER_METRICS_PORT,
    metricsToken: e.METRICS_TOKEN ?? null,
  };
}

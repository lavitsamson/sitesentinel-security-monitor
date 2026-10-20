import { z } from 'zod';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  MONGO_URL: z.string().regex(/^mongodb(\+srv)?:\/\//, 'must be a mongodb:// URL'),
  REDIS_URL: z.string().regex(/^rediss?:\/\//, 'must be a redis:// URL'),
  /** The only browser origin allowed by CORS. */
  WEB_ORIGIN: z.url().default('http://localhost:5173'),
  BODY_LIMIT: z.string().default('100kb'),
  READINESS_TIMEOUT_MS: z.coerce.number().int().positive().default(2_000),
});

export interface Config {
  env: 'development' | 'test' | 'production';
  port: number;
  logLevel: (typeof LOG_LEVELS)[number];
  mongoUrl: string;
  redisUrl: string;
  webOrigin: string;
  bodyLimit: string;
  readinessTimeoutMs: number;
}

/** Parses and validates environment variables, failing fast with every problem listed. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid API configuration:\n${issues.join('\n')}`);
  }
  const e = parsed.data;
  return {
    env: e.NODE_ENV,
    port: e.API_PORT,
    logLevel: e.LOG_LEVEL,
    mongoUrl: e.MONGO_URL,
    redisUrl: e.REDIS_URL,
    webOrigin: e.WEB_ORIGIN,
    bodyLimit: e.BODY_LIMIT,
    readinessTimeoutMs: e.READINESS_TIMEOUT_MS,
  };
}

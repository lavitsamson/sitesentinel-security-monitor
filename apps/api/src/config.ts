import { parseSecretKey } from '@sitesentinel/shared/node';
import { z } from 'zod';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const booleanString = z.enum(['true', 'false']).transform((v) => v === 'true');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
    MONGO_URL: z.string().regex(/^mongodb(\+srv)?:\/\//, 'must be a mongodb:// URL'),
    REDIS_URL: z.string().regex(/^rediss?:\/\//, 'must be a redis:// URL'),
    /** The only browser origin allowed by CORS; also the base of links in emails. */
    WEB_ORIGIN: z.url().default('http://localhost:5173'),
    BODY_LIMIT: z.string().default('100kb'),
    READINESS_TIMEOUT_MS: z.coerce.number().int().positive().default(2_000),
    /** Number of reverse proxies in front of the API, so req.ip is the real client. */
    TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
    /** HMAC key for access tokens. Generate with `openssl rand -base64 48`. */
    JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3_600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(1_440).default(60),
    /** Defaults to true in production. Browsers reject Secure cookies over plain http://localhost. */
    COOKIE_SECURE: booleanString.optional(),
    SMTP_URL: z
      .string()
      .regex(/^smtps?:\/\//, 'must be an smtp:// URL')
      .default('smtp://localhost:1025'),
    MAIL_FROM: z.string().min(3).default('SiteSentinel <no-reply@sitesentinel.local>'),
    /** Encrypts webhook signing secrets at rest; the worker decrypts with the same key. */
    ALERT_SECRET_KEY: z.string().transform((value, ctx) => {
      try {
        return parseSecretKey(value);
      } catch (err) {
        ctx.addIssue({ code: 'custom', message: (err as Error).message });
        return z.NEVER;
      }
    }),
    /** When set, GET /api/v1/metrics requires `Authorization: Bearer <token>`. */
    METRICS_TOKEN: z.string().min(16, 'must be at least 16 characters').optional(),
    /** Bull Board at /admin/queues. Defaults to on outside production, when a password is set. */
    BULL_BOARD_ENABLED: booleanString.optional(),
    BULL_BOARD_USERNAME: z.string().min(1).default('admin'),
    BULL_BOARD_PASSWORD: z.string().min(16, 'must be at least 16 characters').optional(),
  })
  .refine((e) => e.BULL_BOARD_ENABLED !== true || e.BULL_BOARD_PASSWORD !== undefined, {
    message: 'is required when BULL_BOARD_ENABLED=true',
    path: ['BULL_BOARD_PASSWORD'],
  });

export interface AuthConfig {
  jwtSecret: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlDays: number;
  passwordResetTtlMinutes: number;
  cookieSecure: boolean;
}

export interface Config {
  env: 'development' | 'test' | 'production';
  port: number;
  logLevel: (typeof LOG_LEVELS)[number];
  mongoUrl: string;
  redisUrl: string;
  webOrigin: string;
  bodyLimit: string;
  readinessTimeoutMs: number;
  trustProxy: number;
  auth: AuthConfig;
  smtpUrl: string;
  mailFrom: string;
  /** AES-256-GCM key for webhook signing secrets (32 bytes). */
  alertSecretKey: Buffer;
  metricsToken: string | null;
  /** Bull Board sign-in; null when the board is not mounted. */
  queueBoard: { username: string; password: string } | null;
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
    trustProxy: e.TRUST_PROXY,
    auth: {
      jwtSecret: e.JWT_ACCESS_SECRET,
      accessTokenTtlSeconds: e.ACCESS_TOKEN_TTL_SECONDS,
      refreshTokenTtlDays: e.REFRESH_TOKEN_TTL_DAYS,
      passwordResetTtlMinutes: e.PASSWORD_RESET_TTL_MINUTES,
      cookieSecure: e.COOKIE_SECURE ?? e.NODE_ENV === 'production',
    },
    smtpUrl: e.SMTP_URL,
    mailFrom: e.MAIL_FROM,
    alertSecretKey: e.ALERT_SECRET_KEY,
    metricsToken: e.METRICS_TOKEN ?? null,
    queueBoard:
      (e.BULL_BOARD_ENABLED ?? e.NODE_ENV !== 'production') && e.BULL_BOARD_PASSWORD
        ? { username: e.BULL_BOARD_USERNAME, password: e.BULL_BOARD_PASSWORD }
        : null,
  };
}

import type { Request, RequestHandler } from 'express';
import { ipKeyGenerator, rateLimit, type Store } from 'express-rate-limit';
import type { Redis } from 'ioredis';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import { HttpError } from './errors.js';

/** Returns the store for one limiter, or undefined for express-rate-limit's in-memory store. */
export type RateLimitStoreFactory = (name: string) => Store | undefined;

/** Shared counters across API instances. */
export function redisRateLimitStores(redis: Redis): RateLimitStoreFactory {
  return (name) =>
    new RedisStore({
      prefix: `rl:${name}:`,
      sendCommand: (command: string, ...args: string[]) =>
        redis.call(command, ...args) as Promise<RedisReply>,
    });
}

/** Per-process counters; used by tests. */
export const memoryRateLimitStores: RateLimitStoreFactory = () => undefined;

interface LimiterSpec {
  name: string;
  windowMs: number;
  limit: number;
  key: (req: Request, res: Parameters<RequestHandler>[1]) => string;
  message: string;
  /** Don't count requests that fail (4xx/5xx), e.g. check-now on an unverified site. */
  skipFailedRequests?: boolean;
  /** Only count requests that fail, e.g. wrong passwords. */
  skipSuccessfulRequests?: boolean;
}

/** Client IP, with IPv6 grouped by /56 so one host can't rotate through its prefix. */
function clientIp(req: Request): string {
  return ipKeyGenerator(req.ip ?? 'unknown');
}

function emailFromBody(req: Request): string {
  const email: unknown = (req.body as { email?: unknown } | undefined)?.email;
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

const MINUTE = 60_000;

export const RATE_LIMITS = {
  /** Brute-force protection per account and source. */
  login: {
    name: 'login',
    windowMs: MINUTE,
    limit: 5,
    key: (req) => `${clientIp(req)}|${emailFromBody(req)}`,
    message: 'Too many sign-in attempts. Wait a minute and try again.',
  },
  register: {
    name: 'register',
    windowMs: 60 * MINUTE,
    limit: 10,
    key: (req) => clientIp(req),
    message: 'Too many accounts created from this address. Try again later.',
  },
  /** Stops the reset form being used to spam someone's inbox. */
  forgotPassword: {
    name: 'forgot-password',
    windowMs: 15 * MINUTE,
    limit: 5,
    key: (req) => clientIp(req),
    message: 'Too many reset requests. Try again in a few minutes.',
  },
  /** Verification makes outbound DNS/HTTP requests, so it's bounded per user. */
  verifySite: {
    name: 'verify-site',
    windowMs: 10 * MINUTE,
    limit: 10,
    key: (_req, res) => String(res.locals.userId),
    message: 'Too many verification attempts. Wait a few minutes and try again.',
  },
  /** One on-demand check per site per 5 minutes (CLAUDE.md §10), counted per user and site. */
  checkNow: {
    name: 'check-now',
    windowMs: 5 * MINUTE,
    limit: 1,
    key: (req, res) => `${String(res.locals.userId)}|${String(req.params.id)}`,
    message: 'This site was checked on demand in the last 5 minutes. Try again shortly.',
    skipFailedRequests: true,
  },
  bulkSites: {
    name: 'bulk-sites',
    windowMs: MINUTE,
    limit: 10,
    key: (_req, res) => String(res.locals.userId),
    message: 'Too many bulk actions. Wait a minute and try again.',
  },
  /** Test sends reach real inboxes and endpoints, so they're bounded per channel. */
  testAlert: {
    name: 'test-alert',
    windowMs: 5 * MINUTE,
    limit: 3,
    key: (req, res) => `${String(res.locals.userId)}|${String(req.params.id)}`,
    message: 'Too many test alerts for this channel. Try again in a few minutes.',
    skipFailedRequests: true,
  },
  /** Guessing the current password from a stolen session is limited like a login. */
  changePassword: {
    name: 'change-password',
    windowMs: MINUTE,
    limit: 5,
    key: (_req, res) => String(res.locals.userId),
    message: 'Too many password change attempts. Wait a minute and try again.',
  },
  /** Reports are rendered on demand, which costs CPU; plenty for a person clicking. */
  report: {
    name: 'report',
    windowMs: MINUTE,
    limit: 10,
    key: (_req, res) => String(res.locals.userId),
    message: 'Too many reports requested. Wait a minute and try again.',
  },
  /** Wrong Bull Board passwords, per source: the board's password is a single shared secret. */
  queueBoard: {
    name: 'queue-board',
    windowMs: 15 * MINUTE,
    limit: 10,
    key: (req) => clientIp(req),
    message: 'Too many failed sign-ins. Try again later.',
    skipSuccessfulRequests: true,
  },
} satisfies Record<string, LimiterSpec>;

export type RateLimiters = Record<keyof typeof RATE_LIMITS, RequestHandler>;

export function createRateLimiters(stores: RateLimitStoreFactory): RateLimiters {
  const build = (spec: LimiterSpec): RequestHandler =>
    rateLimit({
      windowMs: spec.windowMs,
      limit: spec.limit,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      keyGenerator: spec.key,
      store: stores(spec.name),
      skipFailedRequests: spec.skipFailedRequests ?? false,
      skipSuccessfulRequests: spec.skipSuccessfulRequests ?? false,
      handler: (_req, _res, next) => next(new HttpError(429, 'Too Many Requests', spec.message)),
    });

  return {
    login: build(RATE_LIMITS.login),
    register: build(RATE_LIMITS.register),
    forgotPassword: build(RATE_LIMITS.forgotPassword),
    verifySite: build(RATE_LIMITS.verifySite),
    checkNow: build(RATE_LIMITS.checkNow),
    bulkSites: build(RATE_LIMITS.bulkSites),
    testAlert: build(RATE_LIMITS.testAlert),
    changePassword: build(RATE_LIMITS.changePassword),
    report: build(RATE_LIMITS.report),
    queueBoard: build(RATE_LIMITS.queueBoard),
  };
}

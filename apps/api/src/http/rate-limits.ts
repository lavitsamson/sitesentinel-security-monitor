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
      handler: (_req, _res, next) => next(new HttpError(429, 'Too Many Requests', spec.message)),
    });

  return {
    login: build(RATE_LIMITS.login),
    register: build(RATE_LIMITS.register),
    forgotPassword: build(RATE_LIMITS.forgotPassword),
    verifySite: build(RATE_LIMITS.verifySite),
  };
}

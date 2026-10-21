import { Router, type RequestHandler } from 'express';
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from '@sitesentinel/shared';
import type { AuthConfig } from '../config.js';
import { HttpError } from '../http/errors.js';
import type { RateLimiters } from '../http/rate-limits.js';
import { currentUserId } from './auth.middleware.js';
import type { AuthService } from './auth.service.js';
import { REFRESH_COOKIE, clearSessionCookies, setSessionCookies } from './cookies.js';
import type { SessionService } from './sessions.js';

export interface AuthRouterDeps {
  auth: AuthService;
  sessions: SessionService;
  config: AuthConfig;
  limiters: RateLimiters;
  requireAuth: RequestHandler;
}

export function authRouter({ auth, sessions, config, limiters, requireAuth }: AuthRouterDeps) {
  const router = Router();

  router.post('/auth/register', limiters.register, async (req, res) => {
    const { user, tokens } = await auth.register(registerSchema.parse(req.body));
    setSessionCookies(res, tokens, config);
    res.status(201).json(user);
  });

  router.post('/auth/login', limiters.login, async (req, res) => {
    const { user, tokens } = await auth.login(loginSchema.parse(req.body));
    setSessionCookies(res, tokens, config);
    res.json(user);
  });

  router.post('/auth/refresh', async (req, res) => {
    const token: unknown = req.cookies?.[REFRESH_COOKIE];
    const outcome = typeof token === 'string' ? await sessions.refresh(token) : null;
    if (!outcome?.ok) {
      clearSessionCookies(res, config);
      req.log.info({ reason: outcome?.reason ?? 'missing' }, 'refresh rejected');
      throw new HttpError(401, 'Unauthorized', 'Your session has expired; sign in again');
    }
    setSessionCookies(res, outcome.tokens, config);
    res.status(204).end();
  });

  router.post('/auth/logout', async (req, res) => {
    const token: unknown = req.cookies?.[REFRESH_COOKIE];
    if (typeof token === 'string') await sessions.end(token);
    clearSessionCookies(res, config);
    res.status(204).end();
  });

  router.get('/auth/me', requireAuth, async (_req, res) => {
    res.json(await auth.me(currentUserId(res)));
  });

  router.post('/auth/forgot-password', limiters.forgotPassword, async (req, res) => {
    await auth.forgotPassword(forgotPasswordSchema.parse(req.body));
    res.status(202).end();
  });

  router.post('/auth/reset-password', async (req, res) => {
    const { token, password } = resetPasswordSchema.parse(req.body);
    await auth.resetPassword(token, password);
    clearSessionCookies(res, config);
    res.status(204).end();
  });

  return router;
}

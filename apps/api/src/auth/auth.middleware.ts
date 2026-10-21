import type { RequestHandler, Response } from 'express';
import { HttpError } from '../http/errors.js';
import { ACCESS_COOKIE } from './cookies.js';
import type { AccessTokens } from './tokens.js';

/** Rejects the request with 401 unless it carries a valid access-token cookie. */
export function requireAuth(accessTokens: AccessTokens): RequestHandler {
  return async (req, res, next) => {
    const token: unknown = req.cookies?.[ACCESS_COOKIE];
    const userId = typeof token === 'string' ? await accessTokens.verify(token) : null;
    if (!userId) {
      next(new HttpError(401, 'Unauthorized', 'Sign in to continue'));
      return;
    }
    res.locals.userId = userId;
    next();
  };
}

/** The authenticated user's id. Only valid on routes behind `requireAuth`. */
export function currentUserId(res: Response): string {
  const userId: unknown = res.locals.userId;
  if (typeof userId !== 'string') {
    throw new Error('currentUserId used on a route without requireAuth');
  }
  return userId;
}

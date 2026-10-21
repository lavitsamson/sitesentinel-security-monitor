import type { CookieOptions, Response } from 'express';
import type { AuthConfig } from '../config.js';
import type { SessionTokens } from './sessions.js';

export const ACCESS_COOKIE = 'ss_access';
export const REFRESH_COOKIE = 'ss_refresh';

/** The refresh cookie is only ever sent to the endpoints that need it. */
const REFRESH_COOKIE_PATH = '/api/v1/auth';
const ACCESS_COOKIE_PATH = '/api';

type CookieConfig = Pick<
  AuthConfig,
  'cookieSecure' | 'accessTokenTtlSeconds' | 'refreshTokenTtlDays'
>;

function baseOptions(config: CookieConfig): CookieOptions {
  // httpOnly: unreadable by page scripts (XSS can't exfiltrate the tokens).
  // SameSite=Strict: never attached to cross-site requests (first CSRF layer).
  return { httpOnly: true, secure: config.cookieSecure, sameSite: 'strict' };
}

export function setSessionCookies(res: Response, tokens: SessionTokens, config: CookieConfig) {
  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...baseOptions(config),
    path: ACCESS_COOKIE_PATH,
    maxAge: config.accessTokenTtlSeconds * 1000,
  });
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...baseOptions(config),
    path: REFRESH_COOKIE_PATH,
    maxAge: config.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
  });
}

export function clearSessionCookies(res: Response, config: CookieConfig) {
  res.clearCookie(ACCESS_COOKIE, { ...baseOptions(config), path: ACCESS_COOKIE_PATH });
  res.clearCookie(REFRESH_COOKIE, { ...baseOptions(config), path: REFRESH_COOKIE_PATH });
}

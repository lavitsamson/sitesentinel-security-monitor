import type { RequestHandler } from 'express';
import { HttpError } from './errors.js';

export const CSRF_HEADER = 'x-requested-with';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Second CSRF layer after SameSite cookies. A cross-origin page cannot add a
 * custom header without a CORS preflight, and CORS only allows the web origin,
 * so a forged form post or `fetch(..., { mode: 'no-cors' })` is rejected here.
 */
export const requireCsrfHeader: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method) || req.get(CSRF_HEADER)) {
    next();
    return;
  }
  next(new HttpError(403, 'Forbidden', `Missing ${CSRF_HEADER} header`));
};

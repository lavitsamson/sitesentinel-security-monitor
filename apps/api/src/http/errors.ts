import type { ErrorRequestHandler, RequestHandler, Response } from 'express';
import { ZodError } from 'zod';
import { PROBLEM_CONTENT_TYPE, type ProblemDetails } from '@sitesentinel/shared';
import type { Logger } from '../logger.js';

/** An error that maps directly onto an RFC 9457 response. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly title: string,
    readonly detail?: string,
    readonly errors?: ProblemDetails['errors'],
  ) {
    super(detail ?? title);
    this.name = 'HttpError';
  }
}

export function sendProblem(res: Response, problem: ProblemDetails): void {
  res.status(problem.status).type(PROBLEM_CONTENT_TYPE).json(problem);
}

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new HttpError(404, 'Not Found', `No route for ${req.method} ${req.path}`));
};

/** Shape of errors thrown by Express's body parsers. */
function isBodyParserError(err: unknown): err is { type: string; status: number } {
  return typeof err === 'object' && err !== null && 'type' in err && 'status' in err;
}

function toProblem(err: unknown): ProblemDetails {
  if (err instanceof HttpError) {
    return {
      type: 'about:blank',
      title: err.title,
      status: err.status,
      ...(err.detail && { detail: err.detail }),
      ...(err.errors && { errors: err.errors }),
    };
  }
  if (err instanceof ZodError) {
    return {
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      detail: 'Request validation failed',
      errors: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    };
  }
  if (isBodyParserError(err)) {
    if (err.type === 'entity.too.large') {
      return { type: 'about:blank', title: 'Content Too Large', status: 413 };
    }
    if (err.type === 'entity.parse.failed') {
      return { type: 'about:blank', title: 'Bad Request', status: 400, detail: 'Malformed JSON' };
    }
  }
  // Anything else is a bug: log it, but never leak internals to the client.
  return { type: 'about:blank', title: 'Internal Server Error', status: 500 };
}

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err, req, res, _next) => {
    const problem = { ...toProblem(err), instance: req.originalUrl };
    if (problem.status >= 500) {
      logger.error({ err, reqId: req.id }, 'unhandled error');
    }
    sendProblem(res, problem);
  };
}

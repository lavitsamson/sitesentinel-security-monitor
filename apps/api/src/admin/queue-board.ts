import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { constantTimeEqual } from '@sitesentinel/shared/node';
import type { Queue } from 'bullmq';
import type { Request, RequestHandler } from 'express';
import { HttpError } from '../http/errors.js';

export const QUEUE_BOARD_PATH = '/admin/queues';

export interface QueueBoardCredentials {
  username: string;
  password: string;
}

/** Bull Board's UI and its JSON API, served under QUEUE_BOARD_PATH. */
export function createQueueBoard(queues: readonly Queue[]): RequestHandler {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath(QUEUE_BOARD_PATH);
  createBullBoard({
    queues: queues.map((queue) => new BullMQAdapter(queue)),
    serverAdapter,
    options: { uiConfig: { boardTitle: 'SiteSentinel queues' } },
  });
  return serverAdapter.getRouter() as RequestHandler;
}

function basicCredentials(req: Request): QueueBoardCredentials | null {
  const match = /^Basic ([A-Za-z0-9+/=]+)$/.exec(req.get('authorization') ?? '');
  if (!match?.[1]) return null;
  const decoded = Buffer.from(match[1], 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  if (colon < 0) return null;
  return { username: decoded.slice(0, colon), password: decoded.slice(colon + 1) };
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * The browser attaches Basic credentials to cross-site requests too, so a
 * state-changing request (retry, clean, pause a queue) must come from the
 * board's own pages: Fetch Metadata where the browser sends it, Origin otherwise.
 */
function isSameOrigin(req: Request): boolean {
  const site = req.get('sec-fetch-site');
  if (site) return site === 'same-origin';
  const origin = req.get('origin');
  if (!origin) return true; // not a browser request
  try {
    return new URL(origin).host === req.get('host');
  } catch {
    return false;
  }
}

/**
 * Admin-only access to the board. The app has no admin role (accounts are
 * single-user), so the operator signs in with credentials from the environment.
 */
export function requireQueueBoardAdmin(expected: QueueBoardCredentials): RequestHandler {
  return (req, res, next) => {
    const presented = basicCredentials(req);
    // Both compared every time, so timing doesn't reveal which one was wrong.
    const userOk = constantTimeEqual(presented?.username ?? '', expected.username);
    const passwordOk = constantTimeEqual(presented?.password ?? '', expected.password);
    if (!presented || !userOk || !passwordOk) {
      res.set('www-authenticate', 'Basic realm="SiteSentinel queues", charset="UTF-8"');
      next(new HttpError(401, 'Unauthorized', 'Queue dashboard credentials required'));
      return;
    }
    if (!SAFE_METHODS.has(req.method) && !isSameOrigin(req)) {
      next(
        new HttpError(403, 'Forbidden', 'Cross-site requests to the queue dashboard are refused'),
      );
      return;
    }
    res.set('cache-control', 'no-store');
    next();
  };
}

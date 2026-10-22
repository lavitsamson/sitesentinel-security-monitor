import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from '@prometheus-io/client';
import type { Request, RequestHandler } from 'express';
import type { Logger } from '../logger.js';
import { API_PREFIX } from '../openapi/document.js';

/** Job counts per queue and BullMQ state, e.g. { checks: { waiting: 3, failed: 1 } }. */
export type QueueCounts = Record<string, Record<string, number>>;
export type QueueCountsSource = () => Promise<QueueCounts>;

export interface ApiMetricsOptions {
  /** Process metrics (CPU, memory, event-loop lag, GC). Off in tests: they start timers. */
  defaultMetrics?: boolean;
  /** Read at scrape time; omitted when the API has no queues (tests). */
  queueCounts?: QueueCountsSource;
  logger?: Logger;
}

const DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

/**
 * The route template (`/api/v1/sites/:id`), never the raw path, so one site
 * doesn't become one time series. Requests that never reached a route handler
 * (404s, 401s from the auth middleware) share one label.
 */
export function routeLabel(req: Request): string {
  const path = (req.route as { path?: unknown } | undefined)?.path;
  if (typeof path !== 'string' || !req.originalUrl.startsWith(`${API_PREFIX}/`)) {
    return 'unmatched';
  }
  return `${API_PREFIX}${path}`;
}

/** The API's Prometheus registry: HTTP traffic and queue depth. Job metrics live in the worker. */
export function createApiMetrics({
  defaultMetrics = false,
  queueCounts,
  logger,
}: ApiMetricsOptions = {}) {
  // A registry per app, not the library's global one, so tests can build many apps.
  const registry = new Registry();
  if (defaultMetrics) collectDefaultMetrics({ register: registry });

  const requests = new Counter({
    name: 'sitesentinel_http_requests_total',
    help: 'HTTP requests handled, by method, route template and status code.',
    labelNames: ['method', 'route', 'status'] as const,
    registers: [registry],
  });
  const duration = new Histogram({
    name: 'sitesentinel_http_request_duration_seconds',
    help: 'Time to finish an HTTP response, by method and route template.',
    labelNames: ['method', 'route'] as const,
    buckets: DURATION_BUCKETS,
    registers: [registry],
  });

  if (queueCounts) {
    new Gauge({
      name: 'sitesentinel_queue_jobs',
      help: 'Jobs in each BullMQ queue by state, read from Redis at scrape time (cluster-wide).',
      labelNames: ['queue', 'state'] as const,
      registers: [registry],
      async collect() {
        this.reset();
        try {
          for (const [queue, states] of Object.entries(await queueCounts())) {
            for (const [state, count] of Object.entries(states)) this.set({ queue, state }, count);
          }
        } catch (err) {
          // Leave the series out rather than failing the scrape: HTTP metrics still matter.
          logger?.warn({ err }, 'could not read queue counts for metrics');
        }
      },
    });
  }

  const observeRequests: RequestHandler = (req, res, next) => {
    const end = duration.startTimer();
    res.on('finish', () => {
      const labels = { method: req.method, route: routeLabel(req) };
      end(labels);
      requests.inc({ ...labels, status: String(res.statusCode) });
    });
    next();
  };

  return { registry, observeRequests };
}

export type ApiMetrics = ReturnType<typeof createApiMetrics>;

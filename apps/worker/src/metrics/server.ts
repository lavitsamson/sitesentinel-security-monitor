import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Registry } from '@prometheus-io/client';
import {
  bearerTokenMatches,
  checkReadiness,
  type DependencyProbe,
} from '@sitesentinel/shared/node';
import type { Logger } from '../logger.js';

export interface MetricsServerOptions {
  registry: Registry;
  port: number;
  /** When set, scrapers must send `Authorization: Bearer <token>`. */
  token: string | null;
  /** Dependencies checked by `/health/ready`, each with its own timeout. */
  readiness?: { probes: Record<string, DependencyProbe>; timeoutMs: number };
  logger: Logger;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => ({
  status,
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

/**
 * The worker has no API of its own, so a minimal HTTP server exposes its
 * metrics and the orchestrator's liveness and readiness probes. Only GET, only
 * three paths.
 */
export async function startMetricsServer({
  registry,
  port,
  token,
  readiness = { probes: {}, timeoutMs: 2_000 },
  logger,
}: MetricsServerOptions): Promise<Server> {
  const server = createServer((req, res) => {
    const reply = async () => {
      const path = new URL(req.url ?? '/', 'http://worker').pathname;
      if (req.method !== 'GET') return json(405, { title: 'Method Not Allowed' });
      if (path === '/health/live') return json(200, { status: 'ok' });
      if (path === '/health/ready') {
        const report = await checkReadiness(readiness.probes, readiness.timeoutMs);
        return json(report.status === 'ok' ? 200 : 503, report);
      }
      if (path !== '/metrics') return json(404, { title: 'Not Found' });
      if (token && !bearerTokenMatches(req.headers.authorization, token)) {
        return json(
          401,
          { title: 'Unauthorized' },
          { 'www-authenticate': 'Bearer realm="metrics"' },
        );
      }
      return {
        status: 200,
        headers: { 'content-type': registry.contentType, 'cache-control': 'no-store' },
        body: await registry.metrics(),
      };
    };
    reply()
      .catch((err: unknown) => {
        logger.error({ err }, 'metrics request failed');
        return json(500, { title: 'Internal Server Error' });
      })
      .then(({ status, headers, body }) => res.writeHead(status, headers).end(body));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      server.off('error', reject);
      resolve();
    });
  });
  logger.info({ port: (server.address() as AddressInfo).port }, 'metrics server listening');
  return server;
}

export function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Registry } from '@prometheus-io/client';
import { bearerTokenMatches } from '@sitesentinel/shared/node';
import type { Logger } from '../logger.js';

export interface MetricsServerOptions {
  registry: Registry;
  port: number;
  /** When set, scrapers must send `Authorization: Bearer <token>`. */
  token: string | null;
  logger: Logger;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => ({
  status,
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

/**
 * The worker has no API of its own, so a minimal HTTP server exposes its
 * metrics (and a liveness probe for orchestrators). Only GET, only two paths.
 */
export async function startMetricsServer({
  registry,
  port,
  token,
  logger,
}: MetricsServerOptions): Promise<Server> {
  const server = createServer((req, res) => {
    const reply = async () => {
      const path = new URL(req.url ?? '/', 'http://worker').pathname;
      if (req.method !== 'GET') return json(405, { title: 'Method Not Allowed' });
      if (path === '/health/live') return json(200, { status: 'ok' });
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

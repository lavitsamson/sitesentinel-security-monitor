import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { pino } from 'pino';
import { createWorkerMetrics } from './metrics.js';
import { closeServer, startMetricsServer } from './server.js';

const logger = pino({ level: 'silent' });
const TOKEN = 'worker-metrics-token-0123';

/** A metrics server on a free local port; closed after each test. */
let server: Server | undefined;
async function serve(token: string | null = null) {
  const metrics = createWorkerMetrics();
  metrics.recordCheckRun('TLS', 'PASS');
  server = await startMetricsServer({ registry: metrics.registry, port: 0, token, logger });
  const { port } = server.address() as AddressInfo;
  return (path: string, init?: RequestInit) => fetch(`http://127.0.0.1:${port}${path}`, init);
}

afterEach(async () => {
  if (server) await closeServer(server);
  server = undefined;
});

describe('worker metrics server', () => {
  it('serves Prometheus metrics', async () => {
    const get = await serve();
    const res = await get('/metrics');

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/plain/);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).toContain('sitesentinel_check_runs_total{type="TLS",status="PASS"} 1');
  });

  it('answers a liveness probe', async () => {
    const get = await serve();
    const res = await get('/health/live');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('serves nothing else', async () => {
    const get = await serve();

    expect((await get('/')).status).toBe(404);
    expect((await get('/metrics', { method: 'POST' })).status).toBe(405);
  });

  it('requires the bearer token when one is configured', async () => {
    const get = await serve(TOKEN);

    const missing = await get('/metrics');
    expect(missing.status).toBe(401);
    expect(missing.headers.get('www-authenticate')).toBe('Bearer realm="metrics"');
    expect((await get('/metrics', { headers: { authorization: 'Bearer nope' } })).status).toBe(401);
    expect((await get('/metrics', { headers: { authorization: `Bearer ${TOKEN}` } })).status).toBe(
      200,
    );
    // Probes stay open: orchestrators don't carry the token.
    expect((await get('/health/live')).status).toBe(200);
  });

  it('fails to start when the port is taken', async () => {
    await serve();
    const { port } = server!.address() as AddressInfo;
    const registry = createWorkerMetrics().registry;

    await expect(startMetricsServer({ registry, port, token: null, logger })).rejects.toThrow(
      /EADDRINUSE/,
    );
  });
});

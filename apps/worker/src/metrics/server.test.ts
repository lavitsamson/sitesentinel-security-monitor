import type { Server } from 'node:http';
import type { DependencyProbe } from '@sitesentinel/shared/node';
import type { AddressInfo } from 'node:net';
import { pino } from 'pino';
import { createWorkerMetrics } from './metrics.js';
import { closeServer, startMetricsServer } from './server.js';

const logger = pino({ level: 'silent' });
const TOKEN = 'worker-metrics-token-0123';

/** A metrics server on a free local port; closed after each test. */
let server: Server | undefined;
async function serve(token: string | null = null, probes: Record<string, DependencyProbe> = {}) {
  const metrics = createWorkerMetrics();
  metrics.recordCheckRun('TLS', 'PASS');
  server = await startMetricsServer({
    registry: metrics.registry,
    port: 0,
    token,
    readiness: { probes, timeoutMs: 100 },
    logger,
  });
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

  it('is ready only while every dependency answers', async () => {
    const up = async () => 'PONG';
    const ready = await serve(null, { mongo: up, redis: up });
    const ok = await ready('/health/ready');
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ status: 'ok', checks: { mongo: { status: 'up' } } });
    await closeServer(server!);

    const notReady = await serve(null, { mongo: up, redis: () => new Promise(() => {}) });
    const down = await notReady('/health/ready');
    expect(down.status).toBe(503);
    expect(await down.json()).toMatchObject({
      status: 'error',
      checks: { redis: { status: 'down', error: 'timed out after 100 ms' } },
    });
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
    expect((await get('/health/ready')).status).toBe(200);
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

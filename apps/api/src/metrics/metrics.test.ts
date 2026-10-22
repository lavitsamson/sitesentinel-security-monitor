import request from 'supertest';
import { TEST_CONFIG, buildTestApp, silentLogger } from '../test-utils.js';
import type { Request } from 'express';
import { createApiMetrics, routeLabel } from './metrics.js';

const TOKEN = 'metrics-token-0123456789';

describe('GET /api/v1/metrics', () => {
  it('counts requests by route template, method and status', async () => {
    const app = buildTestApp();
    await request(app).get('/api/v1/health/live').expect(200);
    await request(app).get('/api/v1/health/live').expect(200);
    await request(app).get('/api/v1/no-such-route').expect(404);

    const res = await request(app).get('/api/v1/metrics').expect(200);

    expect(res.headers['content-type']).toMatch(/^text\/plain;.*version=0\.0\.4/);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.text).toContain(
      'sitesentinel_http_requests_total{method="GET",route="/api/v1/health/live",status="200"} 2',
    );
    expect(res.text).toContain(
      'sitesentinel_http_requests_total{method="GET",route="unmatched",status="404"} 1',
    );
    expect(res.text).toMatch(
      /sitesentinel_http_request_duration_seconds_count\{method="GET",route="\/api\/v1\/health\/live"\} 2/,
    );
  });

  it('never puts a raw path in a label', async () => {
    const app = buildTestApp();
    // Not signed in: rejected before the route handler, so it shares the unmatched label.
    await request(app).get('/api/v1/sites/6712f0c2a1b2c3d4e5f60718').expect(401);

    const res = await request(app).get('/api/v1/metrics').expect(200);

    expect(res.text).not.toContain('6712f0c2a1b2c3d4e5f60718');
    expect(res.text).toContain('route="unmatched",status="401"');
  });

  it('reports queue depth by queue and state', async () => {
    const metrics = createApiMetrics({
      queueCounts: async () => ({ checks: { waiting: 3, failed: 1 }, alerts: { waiting: 0 } }),
    });
    const res = await request(buildTestApp({ metrics })).get('/api/v1/metrics').expect(200);

    expect(res.text).toContain('sitesentinel_queue_jobs{queue="checks",state="waiting"} 3');
    expect(res.text).toContain('sitesentinel_queue_jobs{queue="checks",state="failed"} 1');
    expect(res.text).toContain('sitesentinel_queue_jobs{queue="alerts",state="waiting"} 0');
  });

  it('still answers when Redis cannot be read, without queue series', async () => {
    const metrics = createApiMetrics({
      queueCounts: () => Promise.reject(new Error('ECONNREFUSED')),
      logger: silentLogger,
    });
    const res = await request(buildTestApp({ metrics })).get('/api/v1/metrics').expect(200);

    expect(res.text).not.toContain('sitesentinel_queue_jobs{');
    expect(res.text).toContain('sitesentinel_http_requests_total');
  });

  it('requires the bearer token when one is configured', async () => {
    const app = buildTestApp({ config: { ...TEST_CONFIG, metricsToken: TOKEN } });

    const missing = await request(app).get('/api/v1/metrics').expect(401);
    expect(missing.headers['www-authenticate']).toBe('Bearer realm="metrics"');
    expect(missing.headers['content-type']).toMatch(/application\/problem\+json/);
    await request(app).get('/api/v1/metrics').set('authorization', 'Bearer wrong').expect(401);
    await request(app).get('/api/v1/metrics').set('authorization', `Bearer ${TOKEN}`).expect(200);
  });
});

describe('routeLabel', () => {
  const req = (originalUrl: string, path?: string) =>
    ({ originalUrl, route: path === undefined ? undefined : { path } }) as unknown as Request;

  it('uses the route template under the API prefix', () => {
    expect(
      routeLabel(req('/api/v1/sites/6712f0c2a1b2c3d4e5f60718/runs?limit=5', '/sites/:id/runs')),
    ).toBe('/api/v1/sites/:id/runs');
  });

  it('groups requests that matched no API route', () => {
    expect(routeLabel(req('/api/v1/nope'))).toBe('unmatched');
    expect(routeLabel(req('/api/docs/', '/'))).toBe('unmatched');
  });
});

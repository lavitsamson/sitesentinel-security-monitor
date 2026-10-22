import request from 'supertest';
import { TEST_WEB_ORIGIN, buildTestApp } from './test-utils.js';

describe('GET /api/v1/health/live', () => {
  it('returns ok without touching dependencies', async () => {
    const app = buildTestApp({
      readinessProbes: { mongo: () => Promise.reject(new Error('down')) },
    });

    const res = await request(app).get('/api/v1/health/live');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('GET /api/v1/health/ready', () => {
  it('returns 200 when every dependency is up', async () => {
    const res = await request(buildTestApp()).get('/api/v1/health/ready');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.checks.mongo.status).toBe('up');
    expect(res.body.checks.redis.status).toBe('up');
  });

  it('returns 503 and names the failing dependency', async () => {
    const app = buildTestApp({
      readinessProbes: {
        mongo: async () => undefined,
        redis: () => Promise.reject(new Error('ECONNREFUSED')),
      },
    });

    const res = await request(app).get('/api/v1/health/ready');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('error');
    expect(res.body.checks.mongo.status).toBe('up');
    expect(res.body.checks.redis).toMatchObject({ status: 'down', error: 'ECONNREFUSED' });
  });

  it('treats a hanging dependency as down once the timeout passes', async () => {
    const app = buildTestApp({
      readinessProbes: { mongo: () => new Promise(() => undefined) },
    });

    const res = await request(app).get('/api/v1/health/ready');

    expect(res.status).toBe(503);
    expect(res.body.checks.mongo).toMatchObject({
      status: 'down',
      error: 'timed out after 200 ms',
    });
  });
});

describe('error responses (RFC 9457)', () => {
  it('returns problem+json 404 for unknown routes', async () => {
    const res = await request(buildTestApp()).get('/api/v1/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(res.body).toEqual({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: 'No route for GET /api/v1/does-not-exist',
      instance: '/api/v1/does-not-exist',
    });
  });

  it('returns 400 for malformed JSON', async () => {
    const res = await request(buildTestApp())
      .post('/api/v1/anything')
      .set('content-type', 'application/json')
      .send('{"broken":');

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ title: 'Bad Request', detail: 'Malformed JSON' });
  });

  it('returns 413 when the body exceeds the size limit', async () => {
    const res = await request(buildTestApp())
      .post('/api/v1/anything')
      .send({ padding: 'x'.repeat(2_048) });

    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({ title: 'Content Too Large', status: 413 });
  });
});

describe('security middleware', () => {
  it('sets helmet headers and hides the framework', async () => {
    const res = await request(buildTestApp()).get('/api/v1/health/live');

    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['content-security-policy']).toBeDefined();
  });

  it('allows CORS only for the configured web origin', async () => {
    const app = buildTestApp();

    const allowed = await request(app).get('/api/v1/health/live').set('origin', TEST_WEB_ORIGIN);
    const denied = await request(app)
      .get('/api/v1/health/live')
      .set('origin', 'https://evil.example');

    expect(allowed.headers['access-control-allow-origin']).toBe(TEST_WEB_ORIGIN);
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('CSRF header requirement', () => {
  it('lets safe methods through without the header', async () => {
    const res = await request(buildTestApp()).get('/api/v1/health/live');

    expect(res.status).toBe(200);
  });

  it.each(['post', 'patch', 'delete'] as const)(
    'rejects %s without X-Requested-With',
    async (m) => {
      const res = await request(buildTestApp())[m]('/api/v1/sites/abc');

      expect(res.status).toBe(403);
      expect(res.headers['content-type']).toMatch(/problem\+json/);
    },
  );
});

describe('request ids', () => {
  it('generates an id when none is supplied', async () => {
    const res = await request(buildTestApp()).get('/api/v1/health/live');

    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('echoes a safe caller-supplied id', async () => {
    const res = await request(buildTestApp())
      .get('/api/v1/health/live')
      .set('x-request-id', 'trace-123');

    expect(res.headers['x-request-id']).toBe('trace-123');
  });

  it('replaces an unsafe caller-supplied id', async () => {
    const res = await request(buildTestApp())
      .get('/api/v1/health/live')
      .set('x-request-id', 'bad id with spaces');

    expect(res.headers['x-request-id']).not.toBe('bad id with spaces');
  });
});

describe('API docs', () => {
  it('serves an OpenAPI 3.1 document describing the health endpoints', async () => {
    const res = await request(buildTestApp()).get('/api/docs/openapi.json');

    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.1.0');
    expect(Object.keys(res.body.paths)).toEqual(
      expect.arrayContaining(['/api/v1/health/live', '/api/v1/health/ready']),
    );
    expect(res.body.components.schemas.ProblemDetails).toBeDefined();
  });

  it('documents the auth and site routes with cookie security', async () => {
    const res = await request(buildTestApp()).get('/api/docs/openapi.json');

    expect(Object.keys(res.body.paths)).toEqual(
      expect.arrayContaining([
        '/api/v1/auth/register',
        '/api/v1/auth/login',
        '/api/v1/auth/refresh',
        '/api/v1/auth/logout',
        '/api/v1/auth/me',
        '/api/v1/auth/forgot-password',
        '/api/v1/auth/reset-password',
        '/api/v1/sites',
        '/api/v1/sites/{id}',
        '/api/v1/sites/{id}/verify',
        '/api/v1/sites/{id}/check-now',
        '/api/v1/sites/bulk',
        '/api/v1/sites/{id}/runs',
        '/api/v1/sites/{id}/runs/latest',
        '/api/v1/sites/{id}/score-history',
        '/api/v1/incidents',
        '/api/v1/incidents/{id}',
        '/api/v1/auth/change-password',
        '/api/v1/alert-channels',
        '/api/v1/alert-channels/{id}',
        '/api/v1/alert-channels/{id}/test',
      ]),
    );
    expect(res.body.components.schemas.CheckRun).toBeDefined();
    expect(JSON.stringify(res.body.components.schemas.CheckRun)).not.toMatch(/ownerId/);
    expect(res.body.paths['/api/v1/auth/me'].patch).toBeDefined();
    expect(JSON.stringify(res.body.components.schemas.AlertChannel)).not.toMatch(/secret/);
    expect(res.body.components.securitySchemes.cookieAuth).toMatchObject({
      type: 'apiKey',
      in: 'cookie',
      name: 'ss_access',
    });
    expect(res.body.components.schemas.Site.properties).not.toHaveProperty('ownerId');
    expect(JSON.stringify(res.body.components.schemas.User)).not.toMatch(/passwordHash/);
  });

  it('serves Swagger UI', async () => {
    const res = await request(buildTestApp()).get('/api/docs/').redirects(1);

    expect(res.status).toBe(200);
    expect(res.text).toContain('swagger-ui');
  });
});

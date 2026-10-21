import { jest } from '@jest/globals';
import type { VerificationResult } from '@sitesentinel/checks';
import { Types } from 'mongoose';
import request from 'supertest';
import { AuditLogModel, SiteModel } from '@sitesentinel/db';
import { signUp, useTestMongo } from '../test/int-helpers.js';
import { CSRF, buildTestApp } from '../test-utils.js';
import type { VerifyOwnership } from './sites.service.js';

useTestMongo();

type Agent = Awaited<ReturnType<typeof signUp>>['agent'];

async function createSite(agent: Agent, body: Record<string, unknown> = { domain: 'example.com' }) {
  const res = await agent.post('/api/v1/sites').set(CSRF).send(body).expect(201);
  return res.body as { id: string; domain: string; verification: { token: string } };
}

describe('POST /sites', () => {
  it('normalises the domain, applies defaults and returns a verification token', async () => {
    const app = buildTestApp();
    const { agent } = await signUp(app);

    const res = await agent
      .post('/api/v1/sites')
      .set(CSRF)
      .send({ domain: 'https://Bücher.de/', tags: ['Prod'] });

    expect(res.status).toBe(201);
    expect(res.headers.location).toBe(`/api/v1/sites/${res.body.id}`);
    expect(res.body).toMatchObject({
      domain: 'xn--bcher-kva.de',
      displayName: 'xn--bcher-kva.de',
      checkIntervalMinutes: 60,
      paused: false,
      tags: ['prod'],
      status: 'UNKNOWN',
      currentGrade: null,
      demo: false,
      verification: {
        method: null,
        verifiedAt: null,
        token: expect.stringMatching(/^[0-9a-f]{32}$/),
      },
    });
  });

  it('rejects a duplicate domain for the same owner but allows it for another', async () => {
    const app = buildTestApp();
    const { agent: ada } = await signUp(app);
    const { agent: bob } = await signUp(app, 'bob@example.com', 'Bob');
    await createSite(ada);

    const dup = await ada.post('/api/v1/sites').set(CSRF).send({ domain: 'EXAMPLE.com' });
    const other = await bob.post('/api/v1/sites').set(CSRF).send({ domain: 'example.com' });

    expect(dup.status).toBe(409);
    expect(other.status).toBe(201);
  });

  it.each([
    [{ domain: 'localhost' }, 'domain'],
    [{ domain: '10.0.0.1' }, 'domain'],
    [{ domain: 'example.com', checkIntervalMinutes: 1 }, 'checkIntervalMinutes'],
    [{ domain: 'example.com', tags: ['no spaces'] }, 'tags.0'],
  ])('rejects %j with a 400 on %s', async (body, path) => {
    const app = buildTestApp();
    const { agent } = await signUp(app);

    const res = await agent.post('/api/v1/sites').set(CSRF).send(body);

    expect(res.status).toBe(400);
    expect(res.body.errors.map((e: { path: string }) => e.path)).toContain(path);
  });

  it('requires authentication', async () => {
    const res = await request(buildTestApp())
      .post('/api/v1/sites')
      .set(CSRF)
      .send({ domain: 'example.com' });

    expect(res.status).toBe(401);
  });

  it('writes an audit log entry', async () => {
    const app = buildTestApp();
    const { agent, user } = await signUp(app);

    const site = await createSite(agent);

    const entry = await AuditLogModel.findOne({ entityId: site.id });
    expect(entry).toMatchObject({ action: 'site.create', entityType: 'site' });
    expect(entry?.ownerId.toString()).toBe(user.id);
  });
});

describe('GET/PATCH/DELETE /sites/:id', () => {
  it('reads, updates and deletes an owned site', async () => {
    const app = buildTestApp();
    const { agent } = await signUp(app);
    const site = await createSite(agent);

    const read = await agent.get(`/api/v1/sites/${site.id}`);
    const patched = await agent
      .patch(`/api/v1/sites/${site.id}`)
      .set(CSRF)
      .send({ displayName: 'Marketing site', paused: true, checkIntervalMinutes: 15, tags: ['a'] });
    const deleted = await agent.delete(`/api/v1/sites/${site.id}`).set(CSRF);
    const gone = await agent.get(`/api/v1/sites/${site.id}`);

    expect(read.status).toBe(200);
    expect(patched.body).toMatchObject({
      displayName: 'Marketing site',
      paused: true,
      checkIntervalMinutes: 15,
      tags: ['a'],
    });
    expect(deleted.status).toBe(204);
    expect(gone.status).toBe(404);
    const actions = await AuditLogModel.find({ entityId: site.id }).distinct('action');
    expect(actions.sort()).toEqual(['site.create', 'site.delete', 'site.update']);
  });

  it('refuses to change the domain', async () => {
    const app = buildTestApp();
    const { agent } = await signUp(app);
    const site = await createSite(agent);

    const res = await agent
      .patch(`/api/v1/sites/${site.id}`)
      .set(CSRF)
      .send({ domain: 'evil.com' });

    expect(res.status).toBe(400);
  });

  it.each(['not-an-id', '123', 'zzzzzzzzzzzzzzzzzzzzzzzz', new Types.ObjectId().toString()])(
    'returns 404 for id %s',
    async (id) => {
      const app = buildTestApp();
      const { agent } = await signUp(app);

      expect((await agent.get(`/api/v1/sites/${id}`)).status).toBe(404);
    },
  );
});

describe('ownership isolation', () => {
  it("returns 404 (never 403) on every route for another user's site, and changes nothing", async () => {
    const verifyOwnership = jest.fn<VerifyOwnership>();
    const app = buildTestApp({ verifyOwnership });
    const { agent: ada } = await signUp(app);
    const { agent: mallory } = await signUp(app, 'mallory@example.com', 'Mallory');
    const site = await createSite(ada);
    const before = await SiteModel.findById(site.id).lean();

    const responses = await Promise.all([
      mallory.get(`/api/v1/sites/${site.id}`),
      mallory.patch(`/api/v1/sites/${site.id}`).set(CSRF).send({ displayName: 'pwned' }),
      mallory.delete(`/api/v1/sites/${site.id}`).set(CSRF),
      mallory.post(`/api/v1/sites/${site.id}/verify`).set(CSRF).send({}),
    ]);
    const list = await mallory.get('/api/v1/sites');

    expect(responses.map((r) => r.status)).toEqual([404, 404, 404, 404]);
    expect(new Set(responses.map((r) => r.body.detail))).toEqual(new Set(['Site not found']));
    expect(list.body.data).toEqual([]);
    expect(await SiteModel.findById(site.id).lean()).toEqual(before);
    expect(verifyOwnership).not.toHaveBeenCalled();
  });
});

describe('GET /sites', () => {
  /** Seeds sites directly, so score/grade/lastCheckedAt (set by workers later) can vary. */
  async function seedSites(ownerId: string) {
    const rows = [
      { name: 'alpha', score: 95, grade: 'A', status: 'UP', tags: ['prod'], checked: 3 },
      {
        name: 'bravo',
        score: 72,
        grade: 'C',
        status: 'DEGRADED',
        tags: ['prod', 'eu'],
        checked: 1,
      },
      { name: 'charlie', score: null, grade: null, status: 'UNKNOWN', tags: [], checked: null },
      { name: 'delta', score: 72, grade: 'C', status: 'UP', tags: ['eu'], checked: 2 },
      { name: 'echo', score: 40, grade: 'F', status: 'DOWN', tags: [], checked: null },
      { name: 'foxtrot', score: null, grade: null, status: 'UNKNOWN', tags: ['prod'], checked: 5 },
    ];
    await SiteModel.insertMany(
      rows.map((r) => ({
        ownerId: new Types.ObjectId(ownerId),
        domain: `${r.name}.example.com`,
        displayName: r.name,
        verification: { token: 't' },
        checkIntervalMinutes: 60,
        tags: r.tags,
        currentScore: r.score,
        currentGrade: r.grade,
        status: r.status,
        lastCheckedAt: r.checked === null ? null : new Date(Date.UTC(2026, 9, r.checked)),
      })),
    );
  }

  /** Follows nextCursor until the end and returns every display name in order. */
  async function collect(agent: Agent, query: string, limit: number): Promise<string[]> {
    const names: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 20; page++) {
      const params = new URLSearchParams(query);
      params.set('limit', String(limit));
      if (cursor) params.set('cursor', cursor);
      const res = await agent.get(`/api/v1/sites?${params.toString()}`).expect(200);
      names.push(...res.body.data.map((s: { displayName: string }) => s.displayName));
      cursor = res.body.pageInfo.nextCursor;
      expect(res.body.pageInfo.hasNextPage).toBe(cursor !== null);
      if (!cursor) return names;
    }
    throw new Error('pagination did not terminate');
  }

  let app: ReturnType<typeof buildTestApp>;
  let agent: Agent;

  beforeEach(async () => {
    app = buildTestApp();
    const signedUp = await signUp(app);
    agent = signedUp.agent;
    await seedSites(signedUp.user.id);
  });

  it('defaults to name order with a page envelope', async () => {
    const res = await agent.get('/api/v1/sites?limit=2');

    expect(res.body.data.map((s: { displayName: string }) => s.displayName)).toEqual([
      'alpha',
      'bravo',
    ]);
    expect(res.body.pageInfo).toEqual({ nextCursor: expect.any(String), hasNextPage: true });
  });

  // Ties (equal scores, nulls) break on _id, i.e. insertion order here.
  it.each([
    ['sort=name', ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot']],
    ['sort=-name', ['foxtrot', 'echo', 'delta', 'charlie', 'bravo', 'alpha']],
    ['sort=score', ['charlie', 'foxtrot', 'echo', 'bravo', 'delta', 'alpha']],
    ['sort=-score', ['alpha', 'delta', 'bravo', 'echo', 'foxtrot', 'charlie']],
    ['sort=lastCheckedAt', ['charlie', 'echo', 'bravo', 'delta', 'alpha', 'foxtrot']],
    ['sort=-lastCheckedAt', ['foxtrot', 'alpha', 'delta', 'bravo', 'echo', 'charlie']],
  ])('pages through %s without gaps or repeats, across nulls', async (query, expected) => {
    for (const limit of [1, 2, 4, 100]) {
      expect(await collect(agent, query, limit)).toEqual(expected);
    }
  });

  it.each([
    ['grade=C', ['bravo', 'delta']],
    ['status=UNKNOWN', ['charlie', 'foxtrot']],
    ['tag=prod', ['alpha', 'bravo', 'foxtrot']],
    ['tag=eu&grade=C&status=UP', ['delta']],
  ])('filters by %s', async (query, expected) => {
    expect(await collect(agent, query, 2)).toEqual(expected);
  });

  it.each([
    ['limit=101', 400],
    ['limit=0', 400],
    ['sort=ownerId', 400],
    ['grade=Z', 400],
    ['cursor=garbage', 400],
  ])('rejects %s', async (query, status) => {
    expect((await agent.get(`/api/v1/sites?${query}`)).status).toBe(status);
  });

  it('rejects a cursor from a different sort', async () => {
    const first = await agent.get('/api/v1/sites?limit=1&sort=name');

    const res = await agent.get(
      `/api/v1/sites?limit=1&sort=-score&cursor=${first.body.pageInfo.nextCursor}`,
    );

    expect(res.status).toBe(400);
  });
});

describe('POST /sites/:id/verify', () => {
  const verified = (method: 'DNS_TXT' | 'WELL_KNOWN_FILE'): VerificationResult => ({
    verified: true,
    method,
    attempts: [{ method, ok: true, detail: 'found' }],
  });

  it('marks the site verified via DNS and passes the stored token', async () => {
    const verifyOwnership = jest.fn<VerifyOwnership>(async () => verified('DNS_TXT'));
    const app = buildTestApp({ verifyOwnership });
    const { agent } = await signUp(app);
    const site = await createSite(agent);

    const res = await agent.post(`/api/v1/sites/${site.id}/verify`).set(CSRF).send({});

    expect(res.status).toBe(200);
    expect(res.body.verification).toMatchObject({
      method: 'DNS_TXT',
      verifiedAt: expect.any(String),
    });
    expect(verifyOwnership).toHaveBeenCalledWith({
      domain: 'example.com',
      token: site.verification.token,
    });
  });

  it('passes an explicit method through (well-known file)', async () => {
    const verifyOwnership = jest.fn<VerifyOwnership>(async () => verified('WELL_KNOWN_FILE'));
    const app = buildTestApp({ verifyOwnership });
    const { agent } = await signUp(app);
    const site = await createSite(agent);

    const res = await agent
      .post(`/api/v1/sites/${site.id}/verify`)
      .set(CSRF)
      .send({ method: 'WELL_KNOWN_FILE' });

    expect(res.body.verification.method).toBe('WELL_KNOWN_FILE');
    expect(verifyOwnership).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'WELL_KNOWN_FILE' }),
    );
  });

  it('returns 422 with every attempt explained, and stays unverified', async () => {
    const attempts = [
      { method: 'DNS_TXT' as const, ok: false, detail: 'No TXT records found on example.com.' },
      { method: 'WELL_KNOWN_FILE' as const, ok: false, detail: 'returned HTTP 404.' },
    ];
    const app = buildTestApp({
      verifyOwnership: async () => ({ verified: false, method: null, attempts }),
    });
    const { agent } = await signUp(app);
    const site = await createSite(agent);

    const res = await agent.post(`/api/v1/sites/${site.id}/verify`).set(CSRF);
    const after = await agent.get(`/api/v1/sites/${site.id}`);

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      status: 422,
      detail: 'Could not verify ownership of example.com',
      attempts,
    });
    expect(after.body.verification.verifiedAt).toBeNull();
    expect(await AuditLogModel.countDocuments({ action: 'site.verify.failed' })).toBe(1);
  });

  it('rejects an unknown method', async () => {
    const app = buildTestApp();
    const { agent } = await signUp(app);
    const site = await createSite(agent);

    const res = await agent
      .post(`/api/v1/sites/${site.id}/verify`)
      .set(CSRF)
      .send({ method: 'PORT_SCAN' });

    expect(res.status).toBe(400);
  });

  it('is rate-limited per user', async () => {
    const app = buildTestApp();
    const { agent } = await signUp(app);
    const site = await createSite(agent);
    for (let i = 0; i < 10; i++) await agent.post(`/api/v1/sites/${site.id}/verify`).set(CSRF);

    const res = await agent.post(`/api/v1/sites/${site.id}/verify`).set(CSRF);

    expect(res.status).toBe(429);
  });
});

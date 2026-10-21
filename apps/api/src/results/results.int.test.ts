import { CheckRunModel, IncidentModel, SiteModel } from '@sitesentinel/db';
import type { CheckStatus, CheckType } from '@sitesentinel/shared';
import request from 'supertest';
import { manualClock, signUp, useTestMongo } from '../test/int-helpers.js';
import { CSRF, buildTestApp } from '../test-utils.js';

useTestMongo();

type Agent = Awaited<ReturnType<typeof signUp>>['agent'];

// Fixed "now": 2026-10-21 09:00 UTC.
const clock = manualClock();
const daysAgo = (days: number, hour = 9) => new Date(Date.UTC(2026, 9, 21 - days, hour, 0, 0));

async function createSite(agent: Agent, domain = 'example.com') {
  const res = await agent.post('/api/v1/sites').set(CSRF).send({ domain }).expect(201);
  return res.body.id as string;
}

async function addRun(
  siteId: string,
  type: CheckType,
  status: CheckStatus,
  score: number,
  startedAt: Date,
) {
  const site = (await SiteModel.findById(siteId))!;
  return CheckRunModel.create({
    siteId: site._id,
    ownerId: site.ownerId,
    type,
    status,
    score,
    findings: [],
    raw: { note: 'test' },
    durationMs: 42,
    trigger: 'SCHEDULED',
    startedAt,
  });
}

async function twoUsers() {
  const app = buildTestApp({ clock });
  const { agent: ada } = await signUp(app);
  const { agent: bob } = await signUp(app, 'bob@example.com', 'Bob');
  return { ada, bob, site: await createSite(ada) };
}

describe('GET /sites/:id/runs', () => {
  it('lists runs newest first with cursor pagination', async () => {
    const { ada, site } = await twoUsers();
    for (let i = 0; i < 5; i++) await addRun(site, 'TLS', 'PASS', 100, daysAgo(i));

    const first = await ada.get(`/api/v1/sites/${site}/runs?limit=2`).expect(200);
    const second = await ada
      .get(`/api/v1/sites/${site}/runs?limit=2&cursor=${first.body.pageInfo.nextCursor}`)
      .expect(200);
    const third = await ada
      .get(`/api/v1/sites/${site}/runs?limit=2&cursor=${second.body.pageInfo.nextCursor}`)
      .expect(200);

    const startedAt = [first, second, third].flatMap((r) =>
      r.body.data.map((run: { startedAt: string }) => run.startedAt),
    );
    expect(startedAt).toEqual([0, 1, 2, 3, 4].map((d) => daysAgo(d).toISOString()));
    expect(third.body.pageInfo).toEqual({ nextCursor: null, hasNextPage: false });
    expect(first.body.data[0]).toMatchObject({
      siteId: site,
      type: 'TLS',
      status: 'PASS',
      raw: { note: 'test' },
      trigger: 'SCHEDULED',
      durationMs: 42,
    });
  });

  it('filters by type and time window', async () => {
    const { ada, site } = await twoUsers();
    await addRun(site, 'TLS', 'PASS', 100, daysAgo(3));
    await addRun(site, 'TLS', 'PASS', 100, daysAgo(1));
    await addRun(site, 'UPTIME', 'PASS', 100, daysAgo(1));

    const res = await ada
      .get(`/api/v1/sites/${site}/runs`)
      .query({ type: 'TLS', from: daysAgo(2).toISOString(), to: clock.now().toISOString() })
      .expect(200);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].startedAt).toBe(daysAgo(1).toISOString());
  });

  it("returns 404 for another user's site", async () => {
    const { bob, site } = await twoUsers();
    await addRun(site, 'TLS', 'PASS', 100, daysAgo(0));

    await bob.get(`/api/v1/sites/${site}/runs`).expect(404);
    await bob.get(`/api/v1/sites/${site}/runs/latest`).expect(404);
    await bob.get(`/api/v1/sites/${site}/score-history`).expect(404);
  });
});

describe('GET /sites/:id/runs/latest', () => {
  it('returns the newest run of each check type, in check order', async () => {
    const { ada, site } = await twoUsers();
    await addRun(site, 'UPTIME', 'PASS', 100, daysAgo(2));
    await addRun(site, 'UPTIME', 'FAIL', 0, daysAgo(1));
    await addRun(site, 'TLS', 'PASS', 100, daysAgo(2));
    await addRun(site, 'TLS', 'ERROR', 0, daysAgo(0));

    const res = await ada.get(`/api/v1/sites/${site}/runs/latest`).expect(200);

    expect(res.body.data.map((r: { type: string; status: string }) => [r.type, r.status])).toEqual([
      ['TLS', 'ERROR'],
      ['UPTIME', 'FAIL'],
    ]);
  });
});

describe('GET /sites/:id/score-history', () => {
  it('gives one point per day from the latest result of each check, carrying results forward', async () => {
    const { ada, site } = await twoUsers();
    // Before the window: both checks perfect.
    await addRun(site, 'TLS', 'PASS', 100, daysAgo(10));
    await addRun(site, 'SECURITY_HEADERS', 'PASS', 100, daysAgo(10));
    // Two days ago headers drop to 50 (late in the day, after an earlier 80).
    await addRun(site, 'SECURITY_HEADERS', 'WARN', 80, daysAgo(2, 8));
    await addRun(site, 'SECURITY_HEADERS', 'FAIL', 50, daysAgo(2, 20));
    // Yesterday TLS errors (ignored: we couldn't check).
    await addRun(site, 'TLS', 'ERROR', 0, daysAgo(1));

    const res = await ada.get(`/api/v1/sites/${site}/score-history?days=3`).expect(200);

    const degraded = Math.round((100 * 30 + 50 * 25) / 55);
    expect(res.body.data).toEqual([
      { date: '2026-10-19', score: degraded, grade: 'C' },
      { date: '2026-10-20', score: degraded, grade: 'C' },
      { date: '2026-10-21', score: degraded, grade: 'C' },
    ]);
  });

  it('has no score for days before the first run', async () => {
    const { ada, site } = await twoUsers();
    await addRun(site, 'TLS', 'PASS', 100, daysAgo(0));

    const res = await ada.get(`/api/v1/sites/${site}/score-history?days=2`).expect(200);

    expect(res.body.data).toEqual([
      { date: '2026-10-20', score: null, grade: null },
      { date: '2026-10-21', score: 100, grade: 'A' },
    ]);
  });

  it('defaults to 30 days and rejects more than the retention period', async () => {
    const { ada, site } = await twoUsers();

    const res = await ada.get(`/api/v1/sites/${site}/score-history`).expect(200);
    await ada.get(`/api/v1/sites/${site}/score-history?days=91`).expect(400);

    expect(res.body.data).toHaveLength(30);
  });
});

describe('incidents', () => {
  async function addIncident(siteId: string, openedAt: Date, resolvedAt: Date | null = null) {
    const run = await addRun(siteId, 'TLS', 'FAIL', 0, openedAt);
    return IncidentModel.create({
      siteId: run.siteId,
      ownerId: run.ownerId,
      type: resolvedAt ? 'TLS' : 'SECURITY_HEADERS',
      summary: 'Something failed',
      openedAt,
      resolvedAt,
      openingRunId: run._id,
      closingRunId: resolvedAt ? run._id : null,
    });
  }

  it('lists incidents newest first, filtered by open state and site', async () => {
    const { ada, site } = await twoUsers();
    const other = await createSite(ada, 'other.example.com');
    const resolved = await addIncident(site, daysAgo(5), daysAgo(4));
    const open = await addIncident(site, daysAgo(1));
    const elsewhere = await addIncident(other, daysAgo(2));

    const all = await ada.get('/api/v1/incidents').expect(200);
    const onlyOpen = await ada.get('/api/v1/incidents?open=true').expect(200);
    const onlyResolved = await ada.get('/api/v1/incidents?open=false').expect(200);
    const forSite = await ada.get(`/api/v1/incidents?siteId=${site}`).expect(200);
    const ids = (res: { body: { data: { id: string }[] } }) => res.body.data.map((i) => i.id);

    expect(ids(all)).toEqual([open.id, elsewhere.id, resolved.id]);
    expect(ids(onlyOpen)).toEqual([open.id, elsewhere.id]);
    expect(ids(onlyResolved)).toEqual([resolved.id]);
    expect(ids(forSite)).toEqual([open.id, resolved.id]);
    expect(all.body.data[2]).toMatchObject({
      siteId: site,
      type: 'TLS',
      resolvedAt: daysAgo(4).toISOString(),
      closingRunId: expect.any(String),
    });
  });

  it('paginates', async () => {
    const { ada, site } = await twoUsers();
    for (let i = 0; i < 3; i++) await addIncident(site, daysAgo(i + 10), daysAgo(i + 9));

    const first = await ada.get('/api/v1/incidents?limit=2').expect(200);
    const second = await ada
      .get(`/api/v1/incidents?limit=2&cursor=${first.body.pageInfo.nextCursor}`)
      .expect(200);

    expect(first.body.data).toHaveLength(2);
    expect(second.body.data).toHaveLength(1);
    expect(second.body.pageInfo.hasNextPage).toBe(false);
  });

  it("never shows another user's incidents", async () => {
    const { bob, site } = await twoUsers();
    const incident = await addIncident(site, daysAgo(1));

    const list = await bob.get('/api/v1/incidents').expect(200);
    const filtered = await bob.get(`/api/v1/incidents?siteId=${site}`).expect(200);
    await bob.get(`/api/v1/incidents/${incident.id}`).expect(404);
    await bob.get('/api/v1/incidents/not-an-id').expect(404);

    expect(list.body.data).toEqual([]);
    expect(filtered.body.data).toEqual([]);
  });

  it('gets one incident by id', async () => {
    const { ada, site } = await twoUsers();
    const incident = await addIncident(site, daysAgo(1));

    const res = await ada.get(`/api/v1/incidents/${incident.id}`).expect(200);

    expect(res.body).toMatchObject({
      id: incident.id,
      summary: 'Something failed',
      resolvedAt: null,
    });
  });

  it('requires authentication', async () => {
    await request(buildTestApp()).get('/api/v1/incidents').expect(401);
  });
});

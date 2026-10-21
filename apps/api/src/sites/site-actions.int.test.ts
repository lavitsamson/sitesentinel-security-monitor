import { AuditLogModel, CheckRunModel, IncidentModel, SiteModel } from '@sitesentinel/db';
import { CHECK_TYPES, MAX_TAGS, manualCheckSlot } from '@sitesentinel/shared';
import { Types } from 'mongoose';
import { MemoryCheckEnqueuer } from '../infra/check-queue.js';
import { manualClock, signUp, useTestMongo } from '../test/int-helpers.js';
import { CSRF, TEST_AUTH_CONFIG, TEST_WEB_ORIGIN, buildTestApp } from '../test-utils.js';

useTestMongo();

type Agent = Awaited<ReturnType<typeof signUp>>['agent'];

function setup() {
  const checks = new MemoryCheckEnqueuer();
  const clock = manualClock();
  // A production-sized body limit: a 100-id bulk request is bigger than the default test 1kb.
  const config = {
    webOrigin: TEST_WEB_ORIGIN,
    bodyLimit: '100kb',
    readinessTimeoutMs: 200,
    trustProxy: 0,
    auth: TEST_AUTH_CONFIG,
  };
  const app = buildTestApp({ checks, clock, config });
  return { app, checks, clock };
}

/** Creates a site through the API, then marks it verified (verification has its own tests). */
async function createSite(
  agent: Agent,
  domain: string,
  state: { verified?: boolean; paused?: boolean; demo?: boolean; tags?: string[] } = {},
) {
  const res = await agent
    .post('/api/v1/sites')
    .set(CSRF)
    .send({ domain, tags: state.tags ?? [] })
    .expect(201);
  const id = res.body.id as string;
  await SiteModel.updateOne(
    { _id: id },
    {
      'verification.verifiedAt': state.verified === false ? null : new Date(),
      paused: state.paused ?? false,
      demo: state.demo ?? false,
    },
  );
  return id;
}

/** A run and an incident for a site, to prove deletes take its history with it. */
async function addHistory(siteId: string) {
  const site = (await SiteModel.findById(siteId))!;
  const run = await CheckRunModel.create({
    siteId: site._id,
    ownerId: site.ownerId,
    type: 'TLS',
    status: 'FAIL',
    score: 0,
    durationMs: 10,
    trigger: 'SCHEDULED',
    startedAt: new Date(),
  });
  await IncidentModel.create({
    siteId: site._id,
    ownerId: site.ownerId,
    type: 'TLS',
    summary: 'TLS check failed',
    openedAt: new Date(),
    openingRunId: run._id,
  });
}

describe('POST /sites/:id/check-now', () => {
  it('queues every check type as a manual job and returns 202', async () => {
    const { app, checks, clock } = setup();
    const { agent } = await signUp(app);
    const id = await createSite(agent, 'example.com');

    const res = await agent.post(`/api/v1/sites/${id}/check-now`).set(CSRF);

    expect(res.status).toBe(202);
    expect(res.body.queued).toEqual([...CHECK_TYPES]);
    const jobs = [...checks.jobs.values()];
    expect(jobs).toHaveLength(CHECK_TYPES.length);
    for (const job of jobs) {
      expect(job).toMatchObject({
        siteId: id,
        trigger: 'MANUAL',
        slot: manualCheckSlot(clock.now()),
      });
    }
  });

  it('allows one check-now per site per 5 minutes', async () => {
    const { app } = setup();
    const { agent } = await signUp(app);
    const first = await createSite(agent, 'one.example.com');
    const second = await createSite(agent, 'two.example.com');

    await agent.post(`/api/v1/sites/${first}/check-now`).set(CSRF).expect(202);
    const again = await agent.post(`/api/v1/sites/${first}/check-now`).set(CSRF);
    const other = await agent.post(`/api/v1/sites/${second}/check-now`).set(CSRF);

    expect(again.status).toBe(429);
    expect(other.status).toBe(202);
  });

  it.each([
    ['unverified', { verified: false }, /Verify ownership/],
    ['paused', { paused: true }, /Resume monitoring/],
    ['demo', { demo: true }, /Demo sites/],
  ] as const)('refuses a %s site with 409 and queues nothing', async (_label, state, detail) => {
    const { app, checks } = setup();
    const { agent } = await signUp(app);
    const id = await createSite(agent, 'example.com', state);

    const res = await agent.post(`/api/v1/sites/${id}/check-now`).set(CSRF);

    expect(res.status).toBe(409);
    expect(res.body.detail).toMatch(detail);
    expect(checks.jobs.size).toBe(0);
  });

  it("doesn't count a refused request against the rate limit", async () => {
    const { app } = setup();
    const { agent } = await signUp(app);
    const id = await createSite(agent, 'example.com', { verified: false });

    await agent.post(`/api/v1/sites/${id}/check-now`).set(CSRF).expect(409);
    await SiteModel.updateOne({ _id: id }, { 'verification.verifiedAt': new Date() });
    await agent.post(`/api/v1/sites/${id}/check-now`).set(CSRF).expect(202);
  });

  it("returns 404 for another user's site", async () => {
    const { app, checks } = setup();
    const { agent: ada } = await signUp(app);
    const { agent: bob } = await signUp(app, 'bob@example.com', 'Bob');
    const id = await createSite(ada, 'example.com');

    await bob.post(`/api/v1/sites/${id}/check-now`).set(CSRF).expect(404);
    expect(checks.jobs.size).toBe(0);
  });
});

describe('demo sites', () => {
  it('can only be checked daily', async () => {
    const { app } = setup();
    const { agent } = await signUp(app);
    const id = await createSite(agent, 'example.com', { demo: true });

    const res = await agent
      .patch(`/api/v1/sites/${id}`)
      .set(CSRF)
      .send({ checkIntervalMinutes: 5 });
    await agent.patch(`/api/v1/sites/${id}`).set(CSRF).send({ displayName: 'Renamed' }).expect(200);

    expect(res.status).toBe(409);
  });
});

describe('DELETE /sites/:id', () => {
  it('deletes the run history and incidents of the site too', async () => {
    const { app } = setup();
    const { agent } = await signUp(app);
    const id = await createSite(agent, 'example.com');
    const keep = await createSite(agent, 'keep.example.com');
    await addHistory(id);
    await addHistory(keep);

    await agent.delete(`/api/v1/sites/${id}`).set(CSRF).expect(204);

    expect(await CheckRunModel.countDocuments()).toBe(1);
    expect(await IncidentModel.countDocuments()).toBe(1);
    expect(await CheckRunModel.countDocuments({ siteId: new Types.ObjectId(keep) })).toBe(1);
  });
});

describe('POST /sites/bulk', () => {
  async function twoUsers() {
    const ctx = setup();
    const ada = await signUp(ctx.app);
    const bob = await signUp(ctx.app, 'bob@example.com', 'Bob');
    const bobs = await createSite(bob.agent, 'bob.example.com');
    return { ...ctx, ada: ada.agent, bob: bob.agent, bobs };
  }

  const missing = new Types.ObjectId().toString();

  it('pauses and resumes owned sites, reporting others as not found', async () => {
    const { ada, bobs } = await twoUsers();
    const a = await createSite(ada, 'a.example.com');
    const b = await createSite(ada, 'b.example.com');

    const res = await ada
      .post('/api/v1/sites/bulk')
      .set(CSRF)
      .send({ action: 'PAUSE', siteIds: [a, b, bobs, missing] });

    expect(res.status).toBe(200);
    expect(res.body.succeeded.sort()).toEqual([a, b].sort());
    expect(res.body.skipped).toEqual([
      { id: bobs, reason: 'NOT_FOUND' },
      { id: missing, reason: 'NOT_FOUND' },
    ]);
    expect(await SiteModel.countDocuments({ paused: true })).toBe(2);
    expect((await SiteModel.findById(bobs))!.paused).toBe(false);

    await ada
      .post('/api/v1/sites/bulk')
      .set(CSRF)
      .send({ action: 'RESUME', siteIds: [a] });
    expect((await SiteModel.findById(a))!.paused).toBe(false);
  });

  it('checks only sites that can be checked, saying why the rest were skipped', async () => {
    const { ada, checks } = await twoUsers();
    const ok = await createSite(ada, 'ok.example.com');
    const unverified = await createSite(ada, 'new.example.com', { verified: false });
    const paused = await createSite(ada, 'paused.example.com', { paused: true });
    const demo = await createSite(ada, 'demo.example.com', { demo: true });

    const res = await ada
      .post('/api/v1/sites/bulk')
      .set(CSRF)
      .send({ action: 'CHECK_NOW', siteIds: [ok, unverified, paused, demo] });

    expect(res.body.succeeded).toEqual([ok]);
    expect(res.body.skipped).toEqual(
      expect.arrayContaining([
        { id: unverified, reason: 'NOT_VERIFIED' },
        { id: paused, reason: 'PAUSED' },
        { id: demo, reason: 'DEMO' },
      ]),
    );
    expect(new Set([...checks.jobs.values()].map((j) => j.siteId))).toEqual(new Set([ok]));
  });

  it('adds a tag, skipping sites already at the tag limit', async () => {
    const { ada } = await twoUsers();
    const a = await createSite(ada, 'a.example.com', { tags: ['prod'] });
    const full = await createSite(ada, 'full.example.com', {
      tags: Array.from({ length: MAX_TAGS }, (_, i) => `t${i}`),
    });

    const res = await ada
      .post('/api/v1/sites/bulk')
      .set(CSRF)
      .send({ action: 'ADD_TAG', siteIds: [a, full], tag: 'Prod' });
    await ada
      .post('/api/v1/sites/bulk')
      .set(CSRF)
      .send({ action: 'ADD_TAG', siteIds: [a], tag: 'eu' });

    expect(res.body.skipped).toEqual([{ id: full, reason: 'TAG_LIMIT' }]);
    expect((await SiteModel.findById(a))!.tags).toEqual(['prod', 'eu']);
  });

  it('deletes sites with their history and audits each one', async () => {
    const { ada, bobs } = await twoUsers();
    const a = await createSite(ada, 'a.example.com');
    await addHistory(a);
    await addHistory(bobs);

    const res = await ada
      .post('/api/v1/sites/bulk')
      .set(CSRF)
      .send({ action: 'DELETE', siteIds: [a, bobs] });

    expect(res.body.succeeded).toEqual([a]);
    expect(await SiteModel.exists({ _id: a })).toBeNull();
    expect(await SiteModel.exists({ _id: bobs })).not.toBeNull();
    expect(await CheckRunModel.countDocuments()).toBe(1);
    expect(await IncidentModel.countDocuments()).toBe(1);
    expect(await AuditLogModel.findOne({ action: 'site.bulk.delete' })).toMatchObject({
      entityId: a,
    });
  });

  it.each([
    ['no ids', { action: 'PAUSE', siteIds: [] }],
    ['over 100 ids', { action: 'PAUSE', siteIds: Array(101).fill(missing) }],
    ['ADD_TAG without a tag', { action: 'ADD_TAG', siteIds: [missing] }],
    ['an unknown action', { action: 'SCAN', siteIds: [missing] }],
  ])('rejects %s with 400', async (_label, body) => {
    const { ada } = await twoUsers();
    await ada.post('/api/v1/sites/bulk').set(CSRF).send(body).expect(400);
  });
});

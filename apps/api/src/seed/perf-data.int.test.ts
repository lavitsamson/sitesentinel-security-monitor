import request from 'supertest';
import { CheckRunModel, SiteModel, UserModel } from '@sitesentinel/db';
import { CHECK_TYPES } from '@sitesentinel/shared';
import { useTestMongo } from '../test/int-helpers.js';
import { CSRF, buildTestApp, fastPasswords } from '../test-utils.js';
import { PERF_EMAIL, PERF_PASSWORD, seedPerfData } from './perf-data.js';

useTestMongo();

const now = new Date('2026-10-01T12:00:00Z');

describe('seedPerfData', () => {
  it('creates the requested sites and runs for a perf login', async () => {
    const result = await seedPerfData(
      fastPasswords,
      { sites: 5, runsPerSite: 12, batchSize: 7 },
      now,
    );

    expect(result).toMatchObject({ sites: 5, runs: 60 });
    expect(await CheckRunModel.countDocuments({ ownerId: result.userId })).toBe(60);

    const agent = request.agent(buildTestApp());
    await agent
      .post('/api/v1/auth/login')
      .set(CSRF)
      .send({ email: PERF_EMAIL, password: PERF_PASSWORD })
      .expect(200);
    const res = await agent.get('/api/v1/sites?limit=100&sort=-score').expect(200);
    expect(res.body.data).toHaveLength(5);
  });

  it('never makes a site the worker would check', async () => {
    await seedPerfData(fastPasswords, { sites: 20, runsPerSite: 1 }, now);

    const sites = await SiteModel.find();
    for (const site of sites) {
      expect(site).toMatchObject({ paused: true, demo: true });
      expect(site.domain).toMatch(/\.perf\.example\.com$/);
    }
  });

  it('spreads runs over every check type within the retention window', async () => {
    await seedPerfData(fastPasswords, { sites: 1, runsPerSite: 30 }, now);

    const runs = await CheckRunModel.find().lean();
    expect(new Set(runs.map((r) => r.type))).toEqual(new Set(CHECK_TYPES));
    const oldest = Math.min(...runs.map((r) => r.startedAt.getTime()));
    expect(now.getTime() - oldest).toBeLessThanOrEqual(31 * 24 * 3600 * 1000);
  });

  it('replaces its own previous data when re-run', async () => {
    await seedPerfData(fastPasswords, { sites: 3, runsPerSite: 2 }, now);
    await seedPerfData(fastPasswords, { sites: 2, runsPerSite: 2 }, now);

    expect(await UserModel.countDocuments({ email: PERF_EMAIL })).toBe(1);
    expect(await SiteModel.countDocuments()).toBe(2);
    expect(await CheckRunModel.countDocuments()).toBe(4);
  });
});

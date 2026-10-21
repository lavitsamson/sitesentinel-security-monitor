import request from 'supertest';
import { CheckRunModel, IncidentModel, SiteModel, UserModel } from '@sitesentinel/db';
import { CHECK_TYPES } from '@sitesentinel/shared';
import { useTestMongo } from '../test/int-helpers.js';
import { CSRF, buildTestApp, fastPasswords } from '../test-utils.js';
import { DEMO_EMAIL, DEMO_PASSWORD, DEMO_SITES, seedDemoData } from './demo-data.js';
import { DEMO_HISTORY_DAYS } from './demo-history.js';

useTestMongo();

describe('seedDemoData', () => {
  it('creates a demo login whose sites are labelled demo and pre-verified', async () => {
    await seedDemoData(fastPasswords);
    const agent = request.agent(buildTestApp());

    await agent
      .post('/api/v1/auth/login')
      .set(CSRF)
      .send({ email: DEMO_EMAIL, password: DEMO_PASSWORD })
      .expect(200);
    const res = await agent.get('/api/v1/sites?limit=100');

    expect(res.body.data).toHaveLength(DEMO_SITES.length);
    for (const site of res.body.data) {
      expect(site).toMatchObject({ demo: true, checkIntervalMinutes: 1440 });
      expect(site.verification.verifiedAt).not.toBeNull();
    }
  });

  it('generates 30 days of labelled run history with open and resolved incidents', async () => {
    const now = new Date('2026-10-21T09:00:00.000Z');
    const result = await seedDemoData(fastPasswords, now);

    expect(result.runs).toBe(DEMO_SITES.length * CHECK_TYPES.length * DEMO_HISTORY_DAYS);
    const oldest = await CheckRunModel.findOne().sort({ startedAt: 1 });
    expect(now.getTime() - oldest!.startedAt.getTime()).toBeLessThan(
      DEMO_HISTORY_DAYS * 86_400_000,
    );
    expect(await CheckRunModel.countDocuments({ 'raw.demo': { $ne: true } })).toBe(0);
    for (const run of await CheckRunModel.find({ 'findings.0': { $exists: true } })) {
      expect(run.findings.every((f) => f.message.startsWith('Demo data:'))).toBe(true);
    }

    const incidents = await IncidentModel.find();
    expect(incidents.filter((i) => i.resolvedAt === null)).toHaveLength(1);
    expect(incidents.filter((i) => i.resolvedAt !== null).length).toBeGreaterThanOrEqual(1);
    for (const incident of incidents) {
      const opening = await CheckRunModel.findById(incident.openingRunId);
      expect(opening).toMatchObject({ status: 'FAIL', type: incident.type });
    }

    // Site summaries are filled in, and graded across a spread of grades.
    const sites = await SiteModel.find();
    expect(sites.every((s) => s.currentScore !== null && s.lastCheckedAt !== null)).toBe(true);
    expect(new Set(sites.map((s) => s.currentGrade)).size).toBeGreaterThanOrEqual(3);
  });

  it('is idempotent and leaves other users alone', async () => {
    await UserModel.create({ email: 'real@example.com', name: 'Real', passwordHash: 'x' });

    await seedDemoData(fastPasswords);
    await seedDemoData(fastPasswords);

    expect(await UserModel.countDocuments()).toBe(2);
    expect(await SiteModel.countDocuments()).toBe(DEMO_SITES.length);
    expect(await CheckRunModel.countDocuments()).toBe(
      DEMO_SITES.length * CHECK_TYPES.length * DEMO_HISTORY_DAYS,
    );
  });
});

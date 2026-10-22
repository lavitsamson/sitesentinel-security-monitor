import { CheckRunModel, IncidentModel, SiteModel } from '@sitesentinel/db';
import request, { type Response } from 'supertest';
import { manualClock, signUp, useTestMongo } from '../test/int-helpers.js';
import { CSRF, buildTestApp } from '../test-utils.js';

useTestMongo();

type Agent = Awaited<ReturnType<typeof signUp>>['agent'];

// Fixed "now": 2026-10-21 09:00 UTC.
const clock = manualClock();

/** Collects a binary body; supertest only buffers text and JSON by default. */
function binary(res: Response, callback: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

async function createSite(agent: Agent, domain = 'example.com') {
  const res = await agent.post('/api/v1/sites').set(CSRF).send({ domain }).expect(201);
  return res.body.id as string;
}

async function seedResults(siteId: string) {
  const site = (await SiteModel.findById(siteId))!;
  await SiteModel.updateOne({ _id: site._id }, { currentScore: 70, currentGrade: 'C' });
  const run = await CheckRunModel.create({
    siteId: site._id,
    ownerId: site.ownerId,
    type: 'SECURITY_HEADERS',
    status: 'FAIL',
    score: 40,
    findings: [
      {
        code: 'CSP_MISSING',
        severity: 'high',
        message: 'No Content-Security-Policy',
        recommendation: "Add Content-Security-Policy: default-src 'self'",
      },
    ],
    raw: {},
    durationMs: 120,
    trigger: 'SCHEDULED',
    startedAt: new Date('2026-10-21T08:00:00Z'),
  });
  await IncidentModel.create({
    siteId: site._id,
    ownerId: site.ownerId,
    type: 'SECURITY_HEADERS',
    openedAt: run.startedAt,
    openingRunId: run._id,
    summary: 'Security headers check failed',
  });
}

describe('GET /sites/:id/report.pdf', () => {
  it('downloads a one-page PDF report of the site', async () => {
    const app = buildTestApp({ clock });
    const { agent } = await signUp(app);
    const site = await createSite(agent, 'shop.example.com');
    await seedResults(site);

    const res = await agent.get(`/api/v1/sites/${site}/report.pdf`).buffer(true).parse(binary);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="sitesentinel-shop.example.com-2026-10-21.pdf"',
    );
    expect(res.headers['cache-control']).toBe('private, no-store');
    const pdf = res.body as Buffer;
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(Number(res.headers['content-length'])).toBe(pdf.length);
    expect(pdf.toString('latin1')).toContain('(SiteSentinel report: shop.example.com)');
    expect(pdf.toString('latin1')).toContain('(D:20261021090000Z)');
  });

  it("returns 404 for another user's site, and for unknown or malformed ids", async () => {
    const app = buildTestApp({ clock });
    const { agent: ada } = await signUp(app);
    const { agent: bob } = await signUp(app, 'bob@example.com', 'Bob');
    const site = await createSite(ada);

    await bob.get(`/api/v1/sites/${site}/report.pdf`).expect(404);
    await ada.get('/api/v1/sites/6712f0c2a1b2c3d4e5f60718/report.pdf').expect(404);
    await ada.get('/api/v1/sites/not-an-id/report.pdf').expect(404);
  });

  it('requires a session', async () => {
    const app = buildTestApp({ clock });
    const { agent } = await signUp(app);
    const site = await createSite(agent);

    await request(app).get(`/api/v1/sites/${site}/report.pdf`).expect(401);
  });

  it('limits how many reports one user renders per minute', async () => {
    const app = buildTestApp({ clock });
    const { agent } = await signUp(app);
    const site = await createSite(agent);

    for (let i = 0; i < 10; i++) {
      await agent.get(`/api/v1/sites/${site}/report.pdf`).buffer(true).parse(binary).expect(200);
    }
    const limited = await agent.get(`/api/v1/sites/${site}/report.pdf`).expect(429);
    expect(limited.body.detail).toMatch(/Too many reports/);
  });
});

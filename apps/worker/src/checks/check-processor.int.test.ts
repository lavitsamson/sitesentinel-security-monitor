import { jest } from '@jest/globals';
import type { CheckResult } from '@sitesentinel/checks';
import { CheckRunModel, IncidentModel, SiteModel, type SiteDocument } from '@sitesentinel/db';
import type { CheckTrigger, CheckType } from '@sitesentinel/shared';
import { createMemoryDomainLock } from '../infra/domain-lock.js';
import {
  MINUTE,
  MemoryEnqueuer,
  createSite,
  createUser,
  manualClock,
  results,
  silentLogger,
  useTestMongo,
} from '../test/helpers.js';
import {
  DomainBusyError,
  TransientCheckError,
  createCheckProcessor,
  type CheckJobContext,
  type RunCheckFn,
} from './check-processor.js';
import { MAX_RAW_BYTES } from './record-run.js';

useTestMongo();

function setup() {
  const clock = manualClock();
  const lock = createMemoryDomainLock();
  const next: CheckResult[] = [];
  const runCheck = jest.fn<RunCheckFn>(async () => next.shift() ?? results.pass());
  const alerts = new MemoryEnqueuer();
  const process = createCheckProcessor({ runCheck, lock, alerts, clock, logger: silentLogger });

  let jobCounter = 0;
  /** Runs one check of `site` that returns `result`, on its last attempt by default. */
  const run = (
    site: SiteDocument,
    type: CheckType,
    result: CheckResult,
    { attemptsMade = 2, attempts = 3, trigger = 'SCHEDULED' as CheckTrigger } = {},
  ) => {
    next.push(result);
    clock.advance(MINUTE);
    const job: CheckJobContext = {
      id: `job-${++jobCounter}`,
      data: { siteId: site.id, type, trigger },
      attemptsMade,
      attempts,
    };
    return process(job);
  };
  return { clock, lock, runCheck, alerts, run };
}

async function newSite(overrides: Parameters<typeof createSite>[1] = {}) {
  const owner = await createUser();
  return createSite(owner._id, overrides);
}

const reload = async (site: SiteDocument) => (await SiteModel.findById(site._id))!;

describe('check processor: runs and site summary', () => {
  it('stores the run and updates score, grade and lastCheckedAt', async () => {
    const { clock, run } = setup();
    const site = await newSite();

    const outcome = await run(site, 'TLS', results.warn(85));

    expect(outcome.kind).toBe('RECORDED');
    const [stored] = await CheckRunModel.find({ siteId: site._id });
    expect(stored).toMatchObject({
      type: 'TLS',
      status: 'WARN',
      score: 85,
      trigger: 'SCHEDULED',
      ownerId: site.ownerId,
    });
    expect(stored!.findings).toHaveLength(1);
    expect(await reload(site)).toMatchObject({
      currentScore: 85,
      currentGrade: 'B',
      lastCheckedAt: clock.now(),
    });
  });

  it('scores the site as the weighted average of the latest run of each check', async () => {
    const { run } = setup();
    const site = await newSite();

    await run(site, 'TLS', results.fail(0)); // superseded below
    await run(site, 'TLS', results.pass()); // weight 30
    await run(site, 'SECURITY_HEADERS', results.warn(60)); // weight 25

    expect((await reload(site)).currentScore).toBe(Math.round((100 * 30 + 60 * 25) / 55));
  });

  it('retries an ERROR result instead of storing it, until the last attempt', async () => {
    const { run, lock } = setup();
    const site = await newSite();
    await run(site, 'TLS', results.pass());

    await expect(run(site, 'TLS', results.error(), { attemptsMade: 0 })).rejects.toBeInstanceOf(
      TransientCheckError,
    );
    expect(await CheckRunModel.countDocuments({ status: 'ERROR' })).toBe(0);
    expect(lock.held()).toEqual([]); // released even though the attempt threw

    await run(site, 'TLS', results.error(), { attemptsMade: 2 });
    expect(await CheckRunModel.countDocuments({ status: 'ERROR' })).toBe(1);
    // ERROR means "couldn't check": the score still reflects the last real result.
    expect((await reload(site)).currentScore).toBe(100);
  });

  it('caps oversized evidence', async () => {
    const { run } = setup();
    const site = await newSite();

    await run(site, 'SECURITY_HEADERS', results.pass({ body: 'x'.repeat(MAX_RAW_BYTES) }));

    const [stored] = await CheckRunModel.find({ siteId: site._id });
    expect(stored!.raw).toMatchObject({ truncated: true });
  });

  it.each([
    ['deleted', 'SITE_DELETED'],
    ['unverified', 'NOT_VERIFIED'],
    ['paused', 'PAUSED'],
  ] as const)('skips a %s site without contacting it', async (state, reason) => {
    const { run, runCheck } = setup();
    const site = await newSite({ verifiedAt: state === 'unverified' ? null : undefined });
    if (state === 'deleted') await site.deleteOne();
    if (state === 'paused') await SiteModel.updateOne({ _id: site._id }, { paused: true });

    expect(await run(site, 'TLS', results.pass())).toEqual({ kind: 'SKIPPED', reason });
    expect(runCheck).not.toHaveBeenCalled();
    expect(await CheckRunModel.countDocuments()).toBe(0);
  });

  it('refuses to run while another check of the same domain holds the lock', async () => {
    const { run, lock, runCheck } = setup();
    const site = await newSite({ domain: 'busy.example.com' });
    await lock.acquire('busy.example.com', 'someone-else');

    await expect(run(site, 'TLS', results.pass())).rejects.toBeInstanceOf(DomainBusyError);
    expect(runCheck).not.toHaveBeenCalled();
  });
});

describe('check processor: site status from UPTIME', () => {
  it('goes DEGRADED on one failure, DOWN on two in a row, then UP again', async () => {
    const { run } = setup();
    const site = await newSite();

    await run(site, 'UPTIME', results.up());
    expect((await reload(site)).status).toBe('UP');
    await run(site, 'UPTIME', results.down());
    expect((await reload(site)).status).toBe('DEGRADED');
    await run(site, 'UPTIME', results.down());
    expect((await reload(site)).status).toBe('DOWN');
    await run(site, 'UPTIME', results.up());
    expect((await reload(site)).status).toBe('UP');
  });

  it('leaves the status alone for other checks', async () => {
    const { run } = setup();
    const site = await newSite();
    await run(site, 'UPTIME', results.up());

    await run(site, 'TLS', results.fail());

    expect((await reload(site)).status).toBe('UP');
  });
});

describe('check processor: incidents', () => {
  it('opens one incident when a check moves to FAIL and resolves it on PASS', async () => {
    const { run } = setup();
    const site = await newSite();

    await run(site, 'TLS', results.pass());
    const opened = await run(site, 'TLS', results.fail());
    await run(site, 'TLS', results.fail());
    await run(site, 'TLS', results.warn());
    expect(await IncidentModel.countDocuments()).toBe(1);
    const open = await IncidentModel.findOne({ siteId: site._id });
    expect(open).toMatchObject({ type: 'TLS', resolvedAt: null, closingRunId: null });
    expect(open!.summary).toMatch(/^TLS check failed for .*: TEST_HIGH message$/);
    expect(opened.kind === 'RECORDED' && opened.transition?.kind).toBe('OPENED');

    const resolved = await run(site, 'TLS', results.pass());

    expect(resolved.kind === 'RECORDED' && resolved.transition?.kind).toBe('RESOLVED');
    const closed = await IncidentModel.findById(open!._id);
    expect(closed!.resolvedAt).not.toBeNull();
    expect(closed!.closingRunId?.toString()).toBe(
      resolved.kind === 'RECORDED' ? resolved.run.id : undefined,
    );

    // A new failure after resolution is a new incident.
    await run(site, 'TLS', results.fail());
    expect(await IncidentModel.countDocuments()).toBe(2);
  });

  it('queues one alert per incident transition, never one per run', async () => {
    const { run, alerts } = setup();
    const site = await newSite();

    await run(site, 'TLS', results.pass());
    await run(site, 'TLS', results.fail());
    await run(site, 'TLS', results.fail());
    await run(site, 'TLS', results.warn());
    const [incident] = await IncidentModel.find();
    expect([...alerts.alerts.values()]).toEqual([
      { kind: 'INCIDENT', incidentId: incident!.id, event: 'OPENED' },
    ]);

    await run(site, 'TLS', results.pass());
    await run(site, 'TLS', results.pass());

    expect([...alerts.alerts.keys()]).toEqual([
      `${incident!.id}.OPENED`,
      `${incident!.id}.RESOLVED`,
    ]);
  });

  it('keeps the run when the alert cannot be queued', async () => {
    const { run, alerts } = setup();
    const site = await newSite();
    alerts.enqueueAlert = async () => {
      throw new Error('redis down');
    };

    const outcome = await run(site, 'TLS', results.fail());

    expect(outcome.kind === 'RECORDED' && outcome.transition?.kind).toBe('OPENED');
    expect(await IncidentModel.countDocuments()).toBe(1);
  });

  it('keeps incidents per check type', async () => {
    const { run } = setup();
    const site = await newSite();

    await run(site, 'TLS', results.fail());
    await run(site, 'SECURITY_HEADERS', results.fail());
    await run(site, 'TLS', results.pass());

    const open = await IncidentModel.find({ resolvedAt: null });
    expect(open.map((i) => i.type)).toEqual(['SECURITY_HEADERS']);
  });

  it('opens an UPTIME incident only once the site is DOWN', async () => {
    const { run } = setup();
    const site = await newSite();

    await run(site, 'UPTIME', results.down());
    expect(await IncidentModel.countDocuments()).toBe(0);
    await run(site, 'UPTIME', results.down());
    const [incident] = await IncidentModel.find();
    expect(incident!.summary).toMatch(/is down: UPTIME_UNREACHABLE message$/);

    await run(site, 'UPTIME', results.up());
    expect((await IncidentModel.findById(incident!._id))!.resolvedAt).not.toBeNull();
  });

  it('allows only one open incident per site and check, even if two runs race', async () => {
    const site = await newSite();
    const open = {
      siteId: site._id,
      ownerId: site.ownerId,
      type: 'TLS' as const,
      summary: 'x',
      openedAt: new Date(),
      openingRunId: site._id,
    };
    await IncidentModel.create(open);

    await expect(IncidentModel.create(open)).rejects.toMatchObject({ code: 11000 });
    await IncidentModel.updateMany({}, { resolvedAt: new Date() });
    await expect(IncidentModel.create(open)).resolves.toBeDefined();
  });
});

import { randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import type { CheckResult } from '@sitesentinel/checks';
import { AlertChannelModel, CheckRunModel } from '@sitesentinel/db';
import { CHECK_TYPES, checkJobId, incidentAlertJobId } from '@sitesentinel/shared';
import type { Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { createAlertProcessor } from '../alerts/alert-processor.js';
import { createAlertSender } from '../alerts/senders.js';
import { createCheckProcessor, type RunCheckFn } from '../checks/check-processor.js';
import { MemoryMailer } from '../mail/mailer.js';
import { createRedisDomainLock } from '../infra/domain-lock.js';
import { createQueueRedis } from '../infra/connections.js';
import { createWorkerMetrics, type WorkerMetrics } from '../metrics/metrics.js';
import type { Scheduler } from '../scheduler/scheduler.js';
import {
  createSite,
  createUser,
  fakeHttp,
  manualClock,
  results,
  silentLogger,
  useTestMongo,
} from '../test/helpers.js';
import type { VerificationProcessor } from '../verification/verification-processor.js';
import {
  bullAlertEnqueuer,
  bullCheckEnqueuer,
  createQueues,
  startWorkers,
  type Queues,
} from './bull.js';

/**
 * These tests need a real Redis (BullMQ runs Lua scripts that no fake implements).
 * CI provides one; locally, `docker compose up -d redis` and set
 * TEST_REDIS_URL=redis://localhost:6379. Each run uses its own key prefix.
 */
const TEST_REDIS_URL = process.env.TEST_REDIS_URL;
const describeWithRedis = TEST_REDIS_URL ? describe : describe.skip;

async function waitFor(condition: () => Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

useTestMongo();

describeWithRedis('BullMQ integration', () => {
  let redis: Redis;
  let prefix: string;
  let queues: Queues;
  let workers: Worker[] = [];
  let mailer: MemoryMailer;
  let metrics: WorkerMetrics;

  beforeEach(async () => {
    metrics = createWorkerMetrics();
    redis = createQueueRedis(TEST_REDIS_URL!);
    await redis.connect();
    prefix = `test-${randomUUID()}`;
    queues = createQueues(redis, prefix);
    mailer = new MemoryMailer();
  });

  afterEach(async () => {
    await Promise.all(workers.map((w) => w.close(true)));
    workers = [];
    for (const queue of Object.values(queues)) {
      await queue.obliterate({ force: true });
      await queue.close();
    }
    await redis.quit();
  });

  async function start(runCheck: RunCheckFn) {
    workers = await startWorkers({
      connection: redis,
      queues,
      prefix,
      concurrency: 4,
      logger: silentLogger,
      metrics,
      processors: {
        check: createCheckProcessor({
          runCheck,
          lock: createRedisDomainLock(redis),
          alerts: bullAlertEnqueuer(queues.alerts, manualClock()),
          clock: manualClock(),
          logger: silentLogger,
        }),
        alert: createAlertProcessor({
          send: createAlertSender({ mailer, http: fakeHttp().client, clock: manualClock() }),
          decryptSecret: (secret) => secret,
          clock: manualClock(),
          logger: silentLogger,
          webOrigin: 'http://localhost:5173',
        }),
        verification: jest.fn() as unknown as VerificationProcessor,
        scheduler: {
          tick: jest.fn(async () => ({ sitesDue: 0, verificationsDue: 0 })),
        } as Scheduler,
      },
    });
  }

  it('ignores a job whose deterministic id is already queued', async () => {
    const enqueuer = bullCheckEnqueuer(queues.checks);
    const siteId = '6712f0c2a1b2c3d4e5f60718';
    const jobs = CHECK_TYPES.map((type) => ({
      siteId,
      type,
      trigger: 'SCHEDULED' as const,
      slot: 'first',
      delayMs: 60_000,
    }));

    await enqueuer.enqueueChecks(jobs);
    await enqueuer.enqueueChecks(jobs);

    expect(await queues.checks.getJobCountByTypes('delayed', 'waiting')).toBe(CHECK_TYPES.length);
    const tls = await queues.checks.getJob(checkJobId(siteId, 'TLS', 'first'));
    expect(tls?.data).toEqual({ siteId, type: 'TLS', trigger: 'SCHEDULED' });
    expect(tls?.opts.attempts).toBe(3);
  });

  it('runs a queued check and stores the run', async () => {
    const owner = await createUser();
    const site = await createSite(owner._id);
    await start(async () => results.pass());

    await bullCheckEnqueuer(queues.checks).enqueueChecks([
      { siteId: site.id, type: 'TLS', trigger: 'MANUAL', slot: 'manual-1' },
    ]);

    await waitFor(async () => (await CheckRunModel.countDocuments({ siteId: site._id })) === 1);
    expect(await CheckRunModel.findOne({ siteId: site._id })).toMatchObject({
      type: 'TLS',
      trigger: 'MANUAL',
      status: 'PASS',
    });
    await waitFor(async () =>
      (await metrics.registry.metrics()).includes(
        'sitesentinel_jobs_processed_total{queue="checks",outcome="completed"} 1',
      ),
    );
    expect(await metrics.registry.metrics()).toContain(
      'sitesentinel_check_runs_total{type="TLS",status="PASS"} 1',
    );
  });

  it('parks a check while its domain is busy, without using up an attempt', async () => {
    const owner = await createUser();
    const site = await createSite(owner._id, { domain: 'busy.example.com' });
    const runCheck = jest.fn<RunCheckFn>(async () => results.pass());
    await start(runCheck);
    await redis.set('lock:domain:busy.example.com', 'another-check', 'PX', 60_000);

    await bullCheckEnqueuer(queues.checks).enqueueChecks([
      { siteId: site.id, type: 'TLS', trigger: 'MANUAL', slot: 'manual-1' },
    ]);
    const id = checkJobId(site.id, 'TLS', 'manual-1');
    await waitFor(async () => (await queues.checks.getJob(id))?.isDelayed() ?? false);
    expect(runCheck).not.toHaveBeenCalled();

    await redis.del('lock:domain:busy.example.com');
    await waitFor(async () => (await queues.checks.getJob(id))?.isCompleted() ?? false);
    expect(await CheckRunModel.countDocuments()).toBe(1);
    // The parked attempts didn't count: the one that ran was the job's first.
    expect((await queues.checks.getJob(id))?.attemptsMade).toBe(1);
    const text = await metrics.registry.metrics();
    expect(text).toMatch(
      /sitesentinel_jobs_processed_total{queue="checks",outcome="delayed"} [1-9]/,
    );
    expect(text).not.toContain('outcome="failed"');
  });

  it('finishes in-flight checks before close() resolves (graceful shutdown)', async () => {
    const owner = await createUser();
    const site = await createSite(owner._id);
    let finish!: (result: CheckResult) => void;
    const started = new Promise<void>((resolveStarted) => {
      void start(
        () =>
          new Promise<CheckResult>((resolve) => {
            finish = resolve;
            resolveStarted();
          }),
      );
    });
    await waitFor(async () => workers.length > 0);

    await bullCheckEnqueuer(queues.checks).enqueueChecks([
      { siteId: site.id, type: 'TLS', trigger: 'MANUAL', slot: 'manual-1' },
    ]);
    await started;

    const closing = Promise.all(workers.map((w) => w.close()));
    setTimeout(() => finish(results.pass()), 200);
    await closing;

    expect(await CheckRunModel.countDocuments({ siteId: site._id })).toBe(1);
  });

  it('alerts once when a queued check opens an incident', async () => {
    const owner = await createUser();
    const site = await createSite(owner._id);
    await AlertChannelModel.create({
      ownerId: owner._id,
      type: 'EMAIL',
      name: 'Me',
      target: 'me@example.com',
    });
    await start(async () => results.fail());

    await bullCheckEnqueuer(queues.checks).enqueueChecks([
      { siteId: site.id, type: 'TLS', trigger: 'MANUAL', slot: 'manual-1' },
    ]);

    await waitFor(async () => mailer.sent.length === 1);
    expect(mailer.last()).toMatchObject({ to: 'me@example.com' });
    expect(mailer.last()!.subject.startsWith('[SiteSentinel] Incident: ')).toBe(true);
    await waitFor(async () => (await queues.alerts.getJobCountByTypes('completed')) === 1);
    const [job] = await queues.alerts.getJobs(['completed']);
    expect(job?.id).toBe(incidentAlertJobId(job!.data.incidentId as string, 'OPENED'));
  });

  it('ignores an alert job for a transition that is already queued', async () => {
    const enqueuer = bullAlertEnqueuer(queues.alerts, manualClock());
    const job = {
      kind: 'INCIDENT',
      incidentId: '6712f0c2a1b2c3d4e5f60718',
      event: 'OPENED',
    } as const;

    await enqueuer.enqueueAlert(job);
    await enqueuer.enqueueAlert(job);

    expect(await queues.alerts.getJobCountByTypes('waiting')).toBe(1);
  });

  it('only lets the holder release a domain lock', async () => {
    const lock = createRedisDomainLock(redis, 60_000);
    const domain = `${prefix}.example.com`;

    const lease = await lock.acquire(domain, 'job-1');
    expect(lease).not.toBeNull();
    expect(await lock.acquire(domain, 'job-2')).toBeNull();

    // job-1's lease expired and job-2 took the domain: job-1's release must not free it.
    await redis.set(`lock:domain:${domain}`, 'job-2');
    await lease!.release();
    expect(await redis.get(`lock:domain:${domain}`)).toBe('job-2');
    await redis.del(`lock:domain:${domain}`);
  });
});

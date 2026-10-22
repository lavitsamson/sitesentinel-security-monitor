import { DelayedError, Queue, Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Clock } from '@sitesentinel/checks';
import {
  QUEUES,
  VERIFICATION_JOB_OPTIONS,
  alertJobEntry,
  alertJobSchema,
  checkJobEntries,
  checkJobSchema,
  verificationJobId,
  verificationJobSchema,
  type AlertEnqueuer,
  type CheckEnqueuer,
} from '@sitesentinel/shared';
import { AlertDeliveryError, type AlertProcessor } from '../alerts/alert-processor.js';
import {
  DomainBusyError,
  TransientCheckError,
  type CheckProcessor,
} from '../checks/check-processor.js';
import type { Logger } from '../logger.js';
import type { WorkerMetrics } from '../metrics/metrics.js';
import type { Scheduler, VerificationEnqueuer } from '../scheduler/scheduler.js';
import type { VerificationProcessor } from '../verification/verification-processor.js';

/** How often the scheduler tick runs. */
export const SCHEDULER_EVERY_MS = 60_000;
const SCHEDULER_ID = 'due-sites';
/** Wait before retrying a check whose domain is busy (plus up to the same again, randomised). */
const BUSY_DOMAIN_RETRY_MS = 3_000;

/** BullMQ's default key prefix; tests pass their own to stay isolated. */
export const DEFAULT_PREFIX = 'bull';

export function createQueues(connection: Redis, prefix = DEFAULT_PREFIX) {
  return {
    checks: new Queue(QUEUES.checks, { connection, prefix }),
    verification: new Queue(QUEUES.verification, { connection, prefix }),
    alerts: new Queue(QUEUES.alerts, { connection, prefix }),
    scheduler: new Queue(QUEUES.scheduler, { connection, prefix }),
  };
}
export type Queues = ReturnType<typeof createQueues>;

export function bullCheckEnqueuer(queue: Queue): CheckEnqueuer {
  return {
    async enqueueChecks(jobs) {
      await queue.addBulk(checkJobEntries(jobs));
    },
  };
}

export function bullAlertEnqueuer(queue: Queue, clock: Clock): AlertEnqueuer {
  return {
    async enqueueAlert(job) {
      const { name, data, opts } = alertJobEntry(job, clock.now());
      await queue.add(name, data, opts);
    },
  };
}

export function bullVerificationEnqueuer(queue: Queue): VerificationEnqueuer {
  return {
    async enqueueVerifications(jobs) {
      await queue.addBulk(
        jobs.map(({ siteId, slot }) => ({
          name: 'reverify',
          data: { siteId },
          opts: { ...VERIFICATION_JOB_OPTIONS, jobId: verificationJobId(siteId, slot) },
        })),
      );
    },
  };
}

export interface WorkerProcessors {
  check: CheckProcessor;
  verification: VerificationProcessor;
  alert: AlertProcessor;
  scheduler: Scheduler;
}

export interface StartWorkersOptions {
  connection: Redis;
  queues: Queues;
  processors: WorkerProcessors;
  concurrency: number;
  logger: Logger;
  prefix?: string;
  /** Records each job attempt's outcome and duration; omitted in tests that don't need it. */
  metrics?: WorkerMetrics;
}

/**
 * Binds the processors to BullMQ. Everything BullMQ-specific lives here: the
 * processors themselves take plain data and are tested without Redis.
 */
export async function startWorkers({
  connection,
  queues,
  processors,
  concurrency,
  logger,
  prefix = DEFAULT_PREFIX,
  metrics,
}: StartWorkersOptions): Promise<Worker[]> {
  const observe = <T>(job: Job, run: () => Promise<T>): Promise<T> =>
    metrics
      ? metrics.observeJob(
          job.queueName,
          { attemptsMade: job.attemptsMade, attempts: job.opts.attempts ?? 1 },
          run,
        )
      : run();

  const checks = new Worker(
    QUEUES.checks,
    (job: Job, token?: string) =>
      observe(job, async () => {
        const data = checkJobSchema.parse(job.data);
        try {
          const outcome = await processors.check({
            id: job.id ?? job.name,
            data,
            attemptsMade: job.attemptsMade,
            attempts: job.opts.attempts ?? 1,
          });
          if (outcome.kind === 'SKIPPED') return outcome;
          metrics?.recordCheckRun(data.type, outcome.run.status);
          return { kind: outcome.kind, runId: outcome.run.id, status: outcome.run.status };
        } catch (err) {
          // A busy domain is not a failure: park the job without using up an attempt.
          if (err instanceof DomainBusyError) {
            const wait = BUSY_DOMAIN_RETRY_MS * (1 + Math.random());
            await job.moveToDelayed(Date.now() + wait, token);
            throw new DelayedError();
          }
          throw err;
        }
      }),
    { connection, concurrency, prefix },
  );

  const verification = new Worker(
    QUEUES.verification,
    (job: Job) =>
      observe(job, () => processors.verification(verificationJobSchema.parse(job.data))),
    { connection, concurrency: 1, prefix },
  );

  const alerts = new Worker(
    QUEUES.alerts,
    (job: Job) =>
      observe(job, () =>
        processors.alert({
          data: alertJobSchema.parse(job.data),
          attemptsMade: job.attemptsMade,
          attempts: job.opts.attempts ?? 1,
        }),
      ),
    { connection, concurrency, prefix },
  );

  // A job scheduler (not setInterval) so that with several worker replicas the
  // tick still runs once a minute in total, not once per replica.
  await queues.scheduler.upsertJobScheduler(
    SCHEDULER_ID,
    { every: SCHEDULER_EVERY_MS },
    { name: 'tick', opts: { removeOnComplete: 100, removeOnFail: 100 } },
  );
  const scheduler = new Worker(
    QUEUES.scheduler,
    (job: Job) => observe(job, () => processors.scheduler.tick()),
    {
      connection,
      concurrency: 1,
      prefix,
    },
  );

  const workers = [checks, verification, alerts, scheduler];
  for (const worker of workers) {
    worker.on('failed', (job, err) => {
      if (err instanceof DelayedError) return;
      // An expected retry of a check that couldn't run: one line, not the whole result.
      if (err instanceof TransientCheckError || err instanceof AlertDeliveryError) {
        logger.info(
          {
            queue: worker.name,
            jobId: job?.id,
            attemptsMade: job?.attemptsMade,
            reason: err.message,
          },
          'job will be retried with backoff',
        );
        return;
      }
      logger.warn(
        { queue: worker.name, jobId: job?.id, attemptsMade: job?.attemptsMade, err },
        'job failed',
      );
    });
    worker.on('error', (err) => logger.error({ queue: worker.name, err }, 'worker error'));
  }
  return workers;
}

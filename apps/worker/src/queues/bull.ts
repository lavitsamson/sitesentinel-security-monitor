import { DelayedError, Queue, Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import {
  QUEUES,
  VERIFICATION_JOB_OPTIONS,
  checkJobEntries,
  checkJobSchema,
  verificationJobId,
  verificationJobSchema,
  type CheckEnqueuer,
} from '@sitesentinel/shared';
import {
  DomainBusyError,
  TransientCheckError,
  type CheckProcessor,
} from '../checks/check-processor.js';
import type { Logger } from '../logger.js';
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
  scheduler: Scheduler;
}

export interface StartWorkersOptions {
  connection: Redis;
  queues: Queues;
  processors: WorkerProcessors;
  concurrency: number;
  logger: Logger;
  prefix?: string;
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
}: StartWorkersOptions): Promise<Worker[]> {
  const checks = new Worker(
    QUEUES.checks,
    async (job: Job, token?: string) => {
      const data = checkJobSchema.parse(job.data);
      try {
        const outcome = await processors.check({
          id: job.id ?? job.name,
          data,
          attemptsMade: job.attemptsMade,
          attempts: job.opts.attempts ?? 1,
        });
        return outcome.kind === 'SKIPPED'
          ? outcome
          : { kind: outcome.kind, runId: outcome.run.id, status: outcome.run.status };
      } catch (err) {
        // A busy domain is not a failure: park the job without using up an attempt.
        if (err instanceof DomainBusyError) {
          const wait = BUSY_DOMAIN_RETRY_MS * (1 + Math.random());
          await job.moveToDelayed(Date.now() + wait, token);
          throw new DelayedError();
        }
        throw err;
      }
    },
    { connection, concurrency, prefix },
  );

  const verification = new Worker(
    QUEUES.verification,
    async (job: Job) => processors.verification(verificationJobSchema.parse(job.data)),
    { connection, concurrency: 1, prefix },
  );

  // A job scheduler (not setInterval) so that with several worker replicas the
  // tick still runs once a minute in total, not once per replica.
  await queues.scheduler.upsertJobScheduler(
    SCHEDULER_ID,
    { every: SCHEDULER_EVERY_MS },
    { name: 'tick', opts: { removeOnComplete: 100, removeOnFail: 100 } },
  );
  const scheduler = new Worker(QUEUES.scheduler, async () => processors.scheduler.tick(), {
    connection,
    concurrency: 1,
    prefix,
  });

  const workers = [checks, verification, scheduler];
  for (const worker of workers) {
    worker.on('failed', (job, err) => {
      if (err instanceof DelayedError) return;
      // An expected retry of a check that couldn't run: one line, not the whole result.
      if (err instanceof TransientCheckError) {
        logger.info(
          {
            queue: worker.name,
            jobId: job?.id,
            attemptsMade: job?.attemptsMade,
            reason: err.message,
          },
          'check errored; retrying with backoff',
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

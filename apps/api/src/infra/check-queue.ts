import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import {
  QUEUES,
  checkJobEntries,
  checkJobId,
  type CheckEnqueuer,
  type CheckJobRequest,
} from '@sitesentinel/shared';

/** The API only produces check-now jobs; the worker owns consuming them. */
export function createCheckQueue(connection: Redis) {
  const queue = new Queue(QUEUES.checks, { connection });
  const enqueuer: CheckEnqueuer = {
    async enqueueChecks(jobs) {
      await queue.addBulk(checkJobEntries(jobs));
    },
  };
  return { queue, enqueuer };
}

/** Records jobs and, like BullMQ, ignores a job whose id it has already seen. */
export class MemoryCheckEnqueuer implements CheckEnqueuer {
  readonly jobs = new Map<string, CheckJobRequest>();

  async enqueueChecks(jobs: readonly CheckJobRequest[]): Promise<void> {
    for (const job of jobs) {
      const id = checkJobId(job.siteId, job.type, job.slot);
      if (!this.jobs.has(id)) this.jobs.set(id, job);
    }
  }
}

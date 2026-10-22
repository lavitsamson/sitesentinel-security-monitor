import type { Queue } from 'bullmq';
import {
  checkJobEntries,
  checkJobId,
  type CheckEnqueuer,
  type CheckJobRequest,
} from '@sitesentinel/shared';

/** Check-now jobs onto the `checks` queue; the worker owns consuming them. */
export function bullCheckEnqueuer(queue: Queue): CheckEnqueuer {
  return {
    async enqueueChecks(jobs) {
      await queue.addBulk(checkJobEntries(jobs));
    },
  };
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

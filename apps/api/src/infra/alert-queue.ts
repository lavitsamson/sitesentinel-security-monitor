import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Clock } from '@sitesentinel/checks';
import { QUEUES, alertJobEntry, type AlertEnqueuer, type AlertJob } from '@sitesentinel/shared';

/** The API only produces test-send jobs; the worker delivers them. */
export function createAlertQueue(connection: Redis, clock: Clock) {
  const queue = new Queue(QUEUES.alerts, { connection });
  const enqueuer: AlertEnqueuer = {
    async enqueueAlert(job) {
      const { name, data, opts } = alertJobEntry(job, clock.now());
      await queue.add(name, data, opts);
    },
  };
  return { queue, enqueuer };
}

/** Records alert jobs in order; used by tests. */
export class MemoryAlertEnqueuer implements AlertEnqueuer {
  readonly jobs: AlertJob[] = [];

  async enqueueAlert(job: AlertJob): Promise<void> {
    this.jobs.push(job);
  }
}

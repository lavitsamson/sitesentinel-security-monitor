import type { Queue } from 'bullmq';
import type { Clock } from '@sitesentinel/checks';
import { alertJobEntry, type AlertEnqueuer, type AlertJob } from '@sitesentinel/shared';

/** Test-send jobs onto the `alerts` queue; the worker delivers them. */
export function bullAlertEnqueuer(queue: Queue, clock: Clock): AlertEnqueuer {
  return {
    async enqueueAlert(job) {
      const { name, data, opts } = alertJobEntry(job, clock.now());
      await queue.add(name, data, opts);
    },
  };
}

/** Records alert jobs in order; used by tests. */
export class MemoryAlertEnqueuer implements AlertEnqueuer {
  readonly jobs: AlertJob[] = [];

  async enqueueAlert(job: AlertJob): Promise<void> {
    this.jobs.push(job);
  }
}

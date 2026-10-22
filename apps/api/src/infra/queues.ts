import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { QUEUES } from '@sitesentinel/shared';
import type { QueueCountsSource } from '../metrics/metrics.js';

/**
 * Handles on every queue. The API only produces check-now and test-alert jobs
 * (the worker consumes everything), but it reads all four for queue-depth
 * metrics and Bull Board.
 */
export function createQueues(connection: Redis) {
  return {
    checks: new Queue(QUEUES.checks, { connection }),
    alerts: new Queue(QUEUES.alerts, { connection }),
    verification: new Queue(QUEUES.verification, { connection }),
    scheduler: new Queue(QUEUES.scheduler, { connection }),
  };
}
export type Queues = ReturnType<typeof createQueues>;

const JOB_STATES = [
  'waiting',
  'prioritized',
  'active',
  'delayed',
  'waiting-children',
  'completed',
  'failed',
] as const;

/** Current job counts of every queue, for the queue-depth gauge. */
export function queueJobCounts(queues: Queues): QueueCountsSource {
  return async () =>
    Object.fromEntries(
      await Promise.all(
        Object.values(queues).map(
          async (queue) => [queue.name, await queue.getJobCounts(...JOB_STATES)] as const,
        ),
      ),
    );
}

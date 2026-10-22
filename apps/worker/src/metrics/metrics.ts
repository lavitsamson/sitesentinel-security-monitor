import { Counter, Histogram, Registry, collectDefaultMetrics } from '@prometheus-io/client';
import type { CheckStatus, CheckType } from '@sitesentinel/shared';
import { DelayedError } from 'bullmq';

/**
 * How a processing attempt ended. `retry`: it failed and BullMQ will try again;
 * `failed`: it failed on its last attempt; `delayed`: parked without using an
 * attempt (a check whose domain was busy).
 */
export type JobOutcome = 'completed' | 'retry' | 'failed' | 'delayed';

export interface AttemptInfo {
  /** Attempts already made before this one. */
  attemptsMade: number;
  /** Total attempts allowed. */
  attempts: number;
}

const DURATION_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 20, 30, 60];

export function outcomeOf(err: unknown, { attemptsMade, attempts }: AttemptInfo): JobOutcome {
  if (err instanceof DelayedError) return 'delayed';
  return attemptsMade + 1 < attempts ? 'retry' : 'failed';
}

/**
 * The worker's Prometheus registry. Jobs run here, so job metrics live here;
 * queue depth is read from Redis by the API instead, so it isn't reported once
 * per worker replica.
 */
export function createWorkerMetrics({ defaultMetrics = false } = {}) {
  const registry = new Registry();
  if (defaultMetrics) collectDefaultMetrics({ register: registry });

  const processed = new Counter({
    name: 'sitesentinel_jobs_processed_total',
    help: 'Job processing attempts, by queue and outcome (completed, retry, failed, delayed).',
    labelNames: ['queue', 'outcome'] as const,
    registers: [registry],
  });
  const duration = new Histogram({
    name: 'sitesentinel_job_duration_seconds',
    help: 'Time spent processing one job attempt, by queue and outcome.',
    labelNames: ['queue', 'outcome'] as const,
    buckets: DURATION_BUCKETS,
    registers: [registry],
  });
  const checkRuns = new Counter({
    name: 'sitesentinel_check_runs_total',
    help: 'Check runs recorded, by check type and result (PASS, WARN, FAIL, ERROR).',
    labelNames: ['type', 'status'] as const,
    registers: [registry],
  });

  return {
    registry,

    /** Runs one job attempt, recording its outcome and duration. Rethrows failures. */
    async observeJob<T>(queue: string, attempt: AttemptInfo, run: () => Promise<T>): Promise<T> {
      const end = duration.startTimer({ queue });
      let outcome: JobOutcome = 'completed';
      try {
        return await run();
      } catch (err) {
        outcome = outcomeOf(err, attempt);
        throw err;
      } finally {
        end({ outcome });
        processed.inc({ queue, outcome });
      }
    },

    recordCheckRun(type: CheckType, status: CheckStatus): void {
      checkRuns.inc({ type, status });
    },
  };
}

export type WorkerMetrics = ReturnType<typeof createWorkerMetrics>;

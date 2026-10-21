import { z } from 'zod';
import { checkTypeSchema, type CheckType } from './enums.js';
import { objectIdSchema } from './ids.js';

/**
 * Queue contracts shared by the API (producer of check-now jobs) and the worker
 * (scheduler, producer and consumer). Plain data only, so this package stays
 * free of BullMQ.
 */
export const QUEUES = {
  /** One job per site per check type. */
  checks: 'checks',
  /** Incident notifications (consumed from milestone 6). */
  alerts: 'alerts',
  /** Weekly re-verification of domain ownership. */
  verification: 'verification',
  /** The once-a-minute tick that enqueues due checks and re-verifications. */
  scheduler: 'scheduler',
} as const;

export const CHECK_TRIGGERS = ['SCHEDULED', 'MANUAL'] as const;
export const checkTriggerSchema = z.enum(CHECK_TRIGGERS);
export type CheckTrigger = z.infer<typeof checkTriggerSchema>;

export const checkJobSchema = z.object({
  siteId: objectIdSchema,
  type: checkTypeSchema,
  trigger: checkTriggerSchema,
});
export type CheckJob = z.infer<typeof checkJobSchema>;

/** What a producer asks for; the job id is derived from (siteId, type, slot). */
export interface CheckJobRequest extends CheckJob {
  slot: string;
  /** Start no earlier than this many ms from now (scheduler jitter). */
  delayMs?: number;
}

/** Puts check jobs on the `checks` queue. BullMQ-backed in production, in-memory in tests. */
export interface CheckEnqueuer {
  enqueueChecks(jobs: readonly CheckJobRequest[]): Promise<void>;
}

export const verificationJobSchema = z.object({ siteId: objectIdSchema });
export type VerificationJob = z.infer<typeof verificationJobSchema>;

/**
 * Deterministic job id. Adding a job whose id already exists is a no-op in
 * BullMQ, so producing the same (site, type, slot) twice can never run a check twice.
 * Parts are joined with '.', not ':' (BullMQ reserves ':' in custom ids).
 */
export function checkJobId(siteId: string, type: CheckType, slot: string): string {
  return [siteId, type, slot].join('.');
}

export function verificationJobId(siteId: string, slot: string): string {
  return [siteId, 'VERIFY', slot].join('.');
}

/** Check-now is allowed once per site per window (CLAUDE.md §10). */
export const MANUAL_CHECK_WINDOW_MS = 5 * 60_000;

/** All manual checks of a site within one window share a slot, so repeats dedupe. */
export function manualCheckSlot(now: Date): string {
  return `manual-${Math.floor(now.getTime() / MANUAL_CHECK_WINDOW_MS)}`;
}

/** Successful ownership is re-proven weekly; after a failure it is retried daily. */
export const REVERIFY_AFTER_DAYS = 7;
export const REVERIFY_RETRY_AFTER_DAYS = 1;
/** Consecutive failed re-verifications that pause a site and revoke its verification. */
export const REVERIFY_MAX_FAILURES = 3;

/**
 * Options for every check job, whoever enqueues it: 3 attempts with exponential
 * backoff (30 s, 60 s). Completed jobs are kept a day for inspection; failed
 * ones only an hour, because a retained failed job blocks its id from being re-added.
 */
export const CHECK_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { age: 24 * 3600, count: 10_000 },
  removeOnFail: { age: 3600 },
} as const;

/**
 * The `addBulk` entries for check jobs. Both producers (API check-now, worker
 * scheduler) go through this, so ids and retry options can't drift apart.
 */
export function checkJobEntries(jobs: readonly CheckJobRequest[]) {
  return jobs.map(({ siteId, type, trigger, slot, delayMs }) => ({
    name: type,
    data: { siteId, type, trigger } satisfies CheckJob,
    opts: {
      ...CHECK_JOB_OPTIONS,
      jobId: checkJobId(siteId, type, slot),
      ...(delayMs !== undefined && { delay: delayMs }),
    },
  }));
}

export const VERIFICATION_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 60_000 },
  removeOnComplete: { age: 24 * 3600 },
  removeOnFail: { age: 3600 },
} as const;

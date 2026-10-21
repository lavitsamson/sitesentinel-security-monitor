import type { Clock } from '@sitesentinel/checks';
import { SiteModel } from '@sitesentinel/db';
import {
  CHECK_TYPES,
  type CheckEnqueuer,
  type CheckIntervalMinutes,
  type CheckJobRequest,
} from '@sitesentinel/shared';
import type { Logger } from '../logger.js';
import {
  checkSlot,
  dueChecksFilter,
  dueReverificationFilter,
  jitterMs,
  verificationSlot,
} from './due.js';

export interface VerificationJobRequest {
  siteId: string;
  slot: string;
}

export interface VerificationEnqueuer {
  enqueueVerifications(jobs: readonly VerificationJobRequest[]): Promise<void>;
}

export interface SchedulerDeps {
  checks: CheckEnqueuer;
  verifications: VerificationEnqueuer;
  clock: Clock;
  logger: Logger;
  /** Sites per enqueue round-trip. */
  batchSize?: number;
}

/** The fields of a due site the scheduler needs. */
interface DueSite {
  _id: { toString(): string };
  checkIntervalMinutes: CheckIntervalMinutes;
  lastCheckedAt: Date | null;
}

export interface TickResult {
  sitesDue: number;
  verificationsDue: number;
}

/**
 * One scheduler pass, run every minute. It streams every due site (not just the
 * first N, which would starve the rest while those are still queued) and
 * enqueues a job per check type. Re-running a tick is harmless: job ids are
 * deterministic, so anything already queued is skipped.
 */
export function createScheduler({
  checks,
  verifications,
  clock,
  logger,
  batchSize = 500,
}: SchedulerDeps) {
  async function scheduleChecks(now: Date): Promise<number> {
    let due = 0;
    let batch: CheckJobRequest[] = [];
    const cursor = SiteModel.find(dueChecksFilter(now))
      .select({ _id: 1, checkIntervalMinutes: 1, lastCheckedAt: 1 })
      .lean<DueSite[]>()
      .cursor();

    for await (const site of cursor) {
      due++;
      const siteId = site._id.toString();
      const slot = checkSlot(site.lastCheckedAt);
      const delayMs = jitterMs(siteId, site.checkIntervalMinutes);
      for (const type of CHECK_TYPES) {
        batch.push({ siteId, type, trigger: 'SCHEDULED', slot, delayMs });
      }
      if (batch.length >= batchSize * CHECK_TYPES.length) {
        await checks.enqueueChecks(batch);
        batch = [];
      }
    }
    if (batch.length) await checks.enqueueChecks(batch);
    return due;
  }

  async function scheduleVerifications(now: Date): Promise<number> {
    const sites = await SiteModel.find(dueReverificationFilter(now))
      .select({ _id: 1, 'verification.lastAttemptAt': 1 })
      .lean();
    const jobs = sites.map((site) => ({
      siteId: site._id.toString(),
      slot: verificationSlot(site.verification.lastAttemptAt),
    }));
    if (jobs.length) await verifications.enqueueVerifications(jobs);
    return jobs.length;
  }

  return {
    async tick(): Promise<TickResult> {
      const now = clock.now();
      const result = {
        sitesDue: await scheduleChecks(now),
        verificationsDue: await scheduleVerifications(now),
      };
      if (result.sitesDue || result.verificationsDue) logger.info(result, 'scheduler tick');
      return result;
    },
  };
}

export type Scheduler = ReturnType<typeof createScheduler>;

import type { CheckResult, CheckTarget, Clock } from '@sitesentinel/checks';
import { SiteModel } from '@sitesentinel/db';
import type { AlertEnqueuer, CheckJob, CheckType } from '@sitesentinel/shared';
import type { DomainLock } from '../infra/domain-lock.js';
import type { Logger } from '../logger.js';
import { recordRun, type RecordedRun } from './record-run.js';

/** The parts of a BullMQ job the processor needs, so it can be tested without Redis. */
export interface CheckJobContext {
  id: string;
  data: CheckJob;
  /** Attempts already used before this one. */
  attemptsMade: number;
  /** Total attempts allowed. */
  attempts: number;
}

/** Another check holds the domain; the job should be delayed, not failed. */
export class DomainBusyError extends Error {
  constructor(readonly domain: string) {
    super(`A check of ${domain} is already running`);
    this.name = 'DomainBusyError';
  }
}

/** The check couldn't run this time; throwing hands it to BullMQ's backoff. */
export class TransientCheckError extends Error {
  constructor(
    type: CheckType,
    domain: string,
    readonly result: CheckResult,
  ) {
    super(`${type} check of ${domain} errored: ${result.findings[0]?.message ?? 'unknown error'}`);
    this.name = 'TransientCheckError';
  }
}

export type SkipReason = 'SITE_DELETED' | 'NOT_VERIFIED' | 'PAUSED';

export type CheckOutcome =
  { kind: 'SKIPPED'; reason: SkipReason } | ({ kind: 'RECORDED' } & RecordedRun);

export type RunCheckFn = (type: CheckType, target: CheckTarget) => Promise<CheckResult>;

export interface CheckProcessorDeps {
  /** `runCheck` from @sitesentinel/checks bound to the SSRF-guarded clients. */
  runCheck: RunCheckFn;
  lock: DomainLock;
  /** Incident transitions are alerted through the `alerts` queue. */
  alerts: AlertEnqueuer;
  clock: Clock;
  logger: Logger;
}

export function createCheckProcessor({
  runCheck,
  lock,
  alerts,
  clock,
  logger,
}: CheckProcessorDeps) {
  return async function processCheck(job: CheckJobContext): Promise<CheckOutcome> {
    const { siteId, type, trigger } = job.data;
    const site = await SiteModel.findById(siteId);

    // Re-checked at run time: the site may have changed since the job was queued.
    // An unverified domain is never contacted, whatever is in the queue.
    if (!site) return { kind: 'SKIPPED', reason: 'SITE_DELETED' };
    if (!site.verification.verifiedAt) return { kind: 'SKIPPED', reason: 'NOT_VERIFIED' };
    if (site.paused) return { kind: 'SKIPPED', reason: 'PAUSED' };

    const lease = await lock.acquire(site.domain, job.id);
    if (!lease) throw new DomainBusyError(site.domain);
    try {
      const startedAt = clock.now();
      const result = await runCheck(type, { domain: site.domain });
      const durationMs = Math.max(0, clock.now().getTime() - startedAt.getTime());

      // Retry ERROR results with backoff; the last attempt is stored as an ERROR run.
      const isLastAttempt = job.attemptsMade + 1 >= job.attempts;
      if (result.status === 'ERROR' && !isLastAttempt) {
        throw new TransientCheckError(type, site.domain, result);
      }

      const recorded = await recordRun({ site, type, trigger, result, startedAt, durationMs });
      const { transition } = recorded;
      if (transition) {
        const incidentId = transition.incident.id;
        logger.info({ siteId, type, incidentId, kind: transition.kind }, 'incident state changed');
        // The run and incident are already stored, so a retry of this job would
        // see no transition: a failure to queue the alert is logged, not rethrown.
        await alerts
          .enqueueAlert({
            kind: 'INCIDENT',
            incidentId,
            event: transition.kind === 'OPENED' ? 'OPENED' : 'RESOLVED',
          })
          .catch((err: unknown) =>
            logger.error({ err, incidentId, kind: transition.kind }, 'failed to queue alert'),
          );
      }
      return { kind: 'RECORDED', ...recorded };
    } finally {
      await lease.release();
    }
  };
}

export type CheckProcessor = ReturnType<typeof createCheckProcessor>;

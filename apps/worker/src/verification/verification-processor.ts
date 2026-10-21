import type { Clock, OwnershipClaim, VerificationResult } from '@sitesentinel/checks';
import { SiteModel, UserModel, recordAudit } from '@sitesentinel/db';
import { REVERIFY_MAX_FAILURES, type VerificationJob } from '@sitesentinel/shared';
import type { Logger } from '../logger.js';
import type { Mailer } from '../mail/mailer.js';

export type VerifyOwnership = (claim: OwnershipClaim) => Promise<VerificationResult>;

export interface VerificationProcessorDeps {
  verifyOwnership: VerifyOwnership;
  mailer: Mailer;
  clock: Clock;
  logger: Logger;
  /** Base of the link in the "monitoring paused" email. */
  webOrigin: string;
}

export type VerificationOutcome =
  | { kind: 'SKIPPED' }
  | { kind: 'VERIFIED' }
  | { kind: 'FAILED'; consecutiveFailures: number }
  | { kind: 'REVOKED' };

/**
 * Weekly re-proof of ownership. Domains change hands, so a one-off verification
 * isn't enough to keep checking a site. After `REVERIFY_MAX_FAILURES` failures
 * in a row the site is paused and its verification revoked: checks stop until
 * the owner verifies again, and they are emailed to say so.
 */
export function createVerificationProcessor({
  verifyOwnership,
  mailer,
  clock,
  logger,
  webOrigin,
}: VerificationProcessorDeps) {
  async function notifyOwner(site: { id: string; domain: string; ownerId: unknown }) {
    const owner = await UserModel.findById(site.ownerId);
    if (!owner) return;
    await mailer.send({
      to: owner.email,
      subject: `SiteSentinel paused monitoring of ${site.domain}`,
      text: [
        `Hi ${owner.name},`,
        '',
        `We could not confirm that you still control ${site.domain}: neither the`,
        `verification DNS TXT record nor the verification file could be found on`,
        `${REVERIFY_MAX_FAILURES} checks in a row.`,
        '',
        'Monitoring is paused and no further checks will run until you verify the domain again:',
        `${webOrigin}/sites/${site.id}`,
      ].join('\n'),
    });
  }

  return async function processVerification(job: VerificationJob): Promise<VerificationOutcome> {
    const site = await SiteModel.findById(job.siteId);
    if (!site || site.demo || site.paused || !site.verification.verifiedAt) {
      return { kind: 'SKIPPED' };
    }

    const result = await verifyOwnership({
      domain: site.domain,
      token: site.verification.token,
    });
    const now = clock.now();

    if (result.verified) {
      await SiteModel.updateOne(
        { _id: site._id },
        {
          $set: {
            'verification.verifiedAt': now,
            'verification.lastAttemptAt': now,
            'verification.method': result.method,
            'verification.consecutiveFailures': 0,
          },
        },
      );
      return { kind: 'VERIFIED' };
    }

    const consecutiveFailures = site.verification.consecutiveFailures + 1;
    if (consecutiveFailures < REVERIFY_MAX_FAILURES) {
      await SiteModel.updateOne(
        { _id: site._id },
        {
          $set: {
            'verification.lastAttemptAt': now,
            'verification.consecutiveFailures': consecutiveFailures,
          },
        },
      );
      logger.warn({ siteId: site.id, consecutiveFailures }, 're-verification failed');
      return { kind: 'FAILED', consecutiveFailures };
    }

    await SiteModel.updateOne(
      { _id: site._id },
      {
        $set: {
          paused: true,
          'verification.verifiedAt': null,
          'verification.lastAttemptAt': now,
          'verification.consecutiveFailures': consecutiveFailures,
        },
      },
    );
    await recordAudit({
      ownerId: site.ownerId.toString(),
      action: 'site.verification.revoked',
      entityType: 'site',
      entityId: site.id,
    });
    logger.warn({ siteId: site.id }, 'verification revoked; site paused');
    await notifyOwner(site);
    return { kind: 'REVOKED' };
  };
}

export type VerificationProcessor = ReturnType<typeof createVerificationProcessor>;

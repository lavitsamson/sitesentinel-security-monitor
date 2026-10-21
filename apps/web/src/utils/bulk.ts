import type { BulkSiteAction, BulkSitesResult, BulkSkipReason } from '@sitesentinel/shared';
import { plural } from './format';

const DONE: Record<BulkSiteAction, string> = {
  CHECK_NOW: 'Queued checks for',
  PAUSE: 'Paused',
  RESUME: 'Resumed',
  DELETE: 'Deleted',
  ADD_TAG: 'Tagged',
};

const SKIP_REASONS: Record<BulkSkipReason, string> = {
  NOT_FOUND: 'not found',
  NOT_VERIFIED: 'not verified',
  PAUSED: 'paused',
  DEMO: 'demo data',
  TAG_LIMIT: 'at the tag limit',
};

/** "Paused 3 sites. Skipped 2: 1 not verified, 1 demo data." */
export function describeBulkResult(result: BulkSitesResult): string {
  const done = `${DONE[result.action]} ${plural(result.succeeded.length, 'site')}.`;
  if (result.skipped.length === 0) return done;

  const counts = new Map<BulkSkipReason, number>();
  for (const { reason } of result.skipped) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  const reasons = [...counts].map(([reason, n]) => `${n} ${SKIP_REASONS[reason]}`).join(', ');
  return `${done} Skipped ${result.skipped.length}: ${reasons}.`;
}

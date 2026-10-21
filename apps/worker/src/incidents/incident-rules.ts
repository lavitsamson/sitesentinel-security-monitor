import {
  IncidentModel,
  isDuplicateKeyError,
  type CheckRunDocument,
  type IncidentDocument,
  type SiteDocument,
} from '@sitesentinel/db';
import type { CheckStatus, CheckType, SiteStatus } from '@sitesentinel/shared';

export type IncidentAction = 'OPEN' | 'RESOLVE' | 'NONE';

export interface IncidentInput {
  hasOpenIncident: boolean;
  type: CheckType;
  runStatus: CheckStatus;
  /** Site status after this run; only meaningful for UPTIME. */
  siteStatus: SiteStatus;
}

/**
 * Incidents follow state changes, never individual runs, so a site that stays
 * broken produces one incident (and, from milestone 6, one alert), not one per check.
 *
 * - Open when a check moves to FAIL. UPTIME is the exception: one failed request
 *   only makes a site DEGRADED, so its incident opens when the site goes DOWN.
 * - Resolve only when the check returns to PASS; WARN keeps an incident open.
 * - ERROR means we couldn't check, which says nothing about the site.
 */
export function incidentAction({
  hasOpenIncident,
  type,
  runStatus,
  siteStatus,
}: IncidentInput): IncidentAction {
  if (runStatus === 'ERROR') return 'NONE';
  if (hasOpenIncident) return runStatus === 'PASS' ? 'RESOLVE' : 'NONE';
  const failing = type === 'UPTIME' ? siteStatus === 'DOWN' : runStatus === 'FAIL';
  return failing ? 'OPEN' : 'NONE';
}

export interface IncidentTransition {
  kind: 'OPENED' | 'RESOLVED';
  incident: IncidentDocument;
}

function summarise(domain: string, run: CheckRunDocument): string {
  const worst =
    run.findings.find((f) => f.severity === 'high') ??
    run.findings.find((f) => f.severity === 'medium');
  const detail = worst ? `: ${worst.message}` : '';
  return run.type === 'UPTIME'
    ? `${domain} is down${detail}`
    : `${run.type} check failed for ${domain}${detail}`;
}

/** Applies `incidentAction` to the database and reports what changed, if anything. */
export async function applyIncidentRules(
  site: Pick<SiteDocument, '_id' | 'ownerId' | 'domain'>,
  run: CheckRunDocument,
  siteStatus: SiteStatus,
): Promise<IncidentTransition | null> {
  const open = await IncidentModel.findOne({ siteId: site._id, type: run.type, resolvedAt: null });
  const action = incidentAction({
    hasOpenIncident: open !== null,
    type: run.type,
    runStatus: run.status,
    siteStatus,
  });

  if (action === 'RESOLVE' && open) {
    open.resolvedAt = run.startedAt;
    open.closingRunId = run._id;
    await open.save();
    return { kind: 'RESOLVED', incident: open };
  }
  if (action === 'OPEN') {
    try {
      const incident = await IncidentModel.create({
        siteId: site._id,
        ownerId: site.ownerId,
        type: run.type,
        summary: summarise(site.domain, run),
        openedAt: run.startedAt,
        openingRunId: run._id,
      });
      return { kind: 'OPENED', incident };
    } catch (err) {
      // Lost a race with another run of the same check: that one opened it.
      if (isDuplicateKeyError(err)) return null;
      throw err;
    }
  }
  return null;
}

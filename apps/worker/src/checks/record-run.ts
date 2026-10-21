import { siteStatusFromUptime, type CheckResult } from '@sitesentinel/checks';
import {
  CheckRunModel,
  SiteModel,
  type CheckRunDocument,
  type SiteDocument,
} from '@sitesentinel/db';
import {
  gradeFor,
  overallScore,
  type CheckStatus,
  type CheckTrigger,
  type CheckType,
  type Grade,
  type SiteStatus,
} from '@sitesentinel/shared';
import { applyIncidentRules, type IncidentTransition } from '../incidents/incident-rules.js';

/** Largest `raw` evidence stored with a run; bigger payloads are replaced by a marker. */
export const MAX_RAW_BYTES = 16 * 1024;

/** UPTIME runs considered when deriving UP / DOWN / DEGRADED. */
const UPTIME_HISTORY = 5;

export function capRaw(raw: Record<string, unknown>): Record<string, unknown> {
  const bytes = Buffer.byteLength(JSON.stringify(raw));
  return bytes <= MAX_RAW_BYTES ? raw : { truncated: true, bytes };
}

export interface RecordRunInput {
  site: SiteDocument;
  type: CheckType;
  trigger: CheckTrigger;
  result: CheckResult;
  startedAt: Date;
  durationMs: number;
}

export interface RecordedRun {
  run: CheckRunDocument;
  score: number | null;
  grade: Grade | null;
  status: SiteStatus;
  transition: IncidentTransition | null;
}

/** Overall score from the newest non-ERROR run of each check type. */
async function currentScore(site: SiteDocument): Promise<number | null> {
  const latest = await CheckRunModel.aggregate<{
    _id: CheckType;
    status: CheckStatus;
    score: number;
  }>([
    { $match: { siteId: site._id, status: { $ne: 'ERROR' } } },
    { $sort: { type: 1, startedAt: -1 } },
    { $group: { _id: '$type', status: { $first: '$status' }, score: { $first: '$score' } } },
  ]);
  return overallScore(latest.map(({ _id, status, score }) => ({ type: _id, status, score })));
}

async function uptimeStatus(site: SiteDocument): Promise<SiteStatus> {
  const recent = await CheckRunModel.find({ siteId: site._id, type: 'UPTIME' })
    .sort({ startedAt: -1 })
    .limit(UPTIME_HISTORY)
    .lean<CheckResult[]>();
  return siteStatusFromUptime(recent);
}

/**
 * Stores a run, then brings the site's summary (score, grade, status,
 * lastCheckedAt) and its incidents up to date. The site is updated with `$set`
 * on just those fields, so a user editing tags at the same moment isn't overwritten.
 */
export async function recordRun({
  site,
  type,
  trigger,
  result,
  startedAt,
  durationMs,
}: RecordRunInput): Promise<RecordedRun> {
  const run = await CheckRunModel.create({
    siteId: site._id,
    ownerId: site.ownerId,
    type,
    status: result.status,
    score: result.score,
    findings: result.findings,
    raw: capRaw(result.raw),
    durationMs,
    trigger,
    startedAt,
  });

  const score = await currentScore(site);
  const grade = score === null ? null : gradeFor(score);
  const status = type === 'UPTIME' ? await uptimeStatus(site) : site.status;
  await SiteModel.updateOne(
    { _id: site._id },
    { $set: { currentScore: score, currentGrade: grade, status, lastCheckedAt: startedAt } },
  );

  const transition = await applyIncidentRules(site, run, status);
  return { run, score, grade, status, transition };
}

import { CheckRunModel, IncidentModel, SiteModel, type SiteDocument } from '@sitesentinel/db';
import {
  CHECK_TYPES,
  gradeFor,
  overallScore,
  securityHeadersStatus,
  type CheckStatus,
  type CheckType,
} from '@sitesentinel/shared';
import { Types } from 'mongoose';

/**
 * Generated history so the demo's charts look real (CLAUDE.md §15). Every finding
 * says "Demo data", and none of it reflects the real sites' security: the worker
 * replaces it with real passive checks once a day.
 */
export const DEMO_HISTORY_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

type DemoSite = Pick<SiteDocument, '_id' | 'ownerId' | 'domain'>;

/** Typical score per check, by profile; sites cycle through them so grades vary A–D. */
const PROFILES: Record<CheckType, number>[] = [
  {
    TLS: 100,
    SECURITY_HEADERS: 95,
    HTTPS_REDIRECT: 100,
    EMAIL_DNS: 100,
    SECURITY_TXT: 100,
    UPTIME: 100,
  },
  {
    TLS: 100,
    SECURITY_HEADERS: 80,
    HTTPS_REDIRECT: 100,
    EMAIL_DNS: 75,
    SECURITY_TXT: 90,
    UPTIME: 100,
  },
  {
    TLS: 100,
    SECURITY_HEADERS: 60,
    HTTPS_REDIRECT: 100,
    EMAIL_DNS: 50,
    SECURITY_TXT: 90,
    UPTIME: 100,
  },
  {
    TLS: 75,
    SECURITY_HEADERS: 45,
    HTTPS_REDIRECT: 85,
    EMAIL_DNS: 50,
    SECURITY_TXT: 90,
    UPTIME: 90,
  },
];

/** Scripted bad spells, `[fromDaysAgo, toDaysAgo]` inclusive, that become incidents. */
interface Episode {
  siteIndex: number;
  type: CheckType;
  daysAgo: [number, number];
  message: string;
}
const EPISODES: Episode[] = [
  { siteIndex: 2, type: 'TLS', daysAgo: [14, 11], message: 'the certificate expired' },
  { siteIndex: 5, type: 'UPTIME', daysAgo: [21, 20], message: 'the homepage did not respond' },
  {
    siteIndex: 9,
    type: 'SECURITY_HEADERS',
    daysAgo: [2, 0],
    message: 'Content-Security-Policy and HSTS are missing',
  },
];

/** Small deterministic PRNG (mulberry32), so every seed produces the same history. */
export function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const demoFinding = (severity: 'medium' | 'high', type: CheckType, detail: string) => ({
  code: `DEMO_${type}`,
  severity,
  message: `Demo data: ${detail}.`,
  recommendation: 'This is generated demo history; real results replace it after the next check.',
});

interface GeneratedRun {
  _id: Types.ObjectId;
  siteId: Types.ObjectId;
  ownerId: Types.ObjectId;
  type: CheckType;
  status: CheckStatus;
  score: number;
  findings: ReturnType<typeof demoFinding>[];
  raw: Record<string, unknown>;
  durationMs: number;
  trigger: 'SCHEDULED';
  startedAt: Date;
}

function generateRuns(site: DemoSite, index: number, now: Date): GeneratedRun[] {
  const profile = PROFILES[index % PROFILES.length]!;
  const random = prng(index + 1);
  const runs: GeneratedRun[] = [];

  for (let daysAgo = DEMO_HISTORY_DAYS - 1; daysAgo >= 0; daysAgo--) {
    // An hour before "now" each day, so the next real daily check isn't due straight away.
    const day = new Date(now.getTime() - daysAgo * DAY_MS - 3600_000);
    CHECK_TYPES.forEach((type, i) => {
      const episode = EPISODES.find(
        (e) =>
          e.siteIndex === index &&
          e.type === type &&
          daysAgo <= e.daysAgo[0] &&
          daysAgo >= e.daysAgo[1],
      );
      const wobble =
        type === 'SECURITY_HEADERS' || type === 'EMAIL_DNS' ? Math.round((random() - 0.5) * 10) : 0;
      const score = episode
        ? type === 'SECURITY_HEADERS'
          ? 35
          : 0
        : Math.max(0, Math.min(100, profile[type] + wobble));
      const status: CheckStatus = episode ? 'FAIL' : securityHeadersStatus(score);
      const responseTimeMs = Math.round(150 + random() * 700);
      const findings = episode
        ? [demoFinding('high', type, episode.message)]
        : status === 'PASS'
          ? []
          : [demoFinding(status === 'FAIL' ? 'high' : 'medium', type, `${type} needs attention`)];

      runs.push({
        _id: new Types.ObjectId(),
        siteId: site._id,
        ownerId: site.ownerId,
        type,
        status,
        score,
        findings,
        raw:
          type === 'UPTIME'
            ? episode
              ? { demo: true, up: false, statusCode: null, responseTimeMs: null }
              : { demo: true, up: true, statusCode: 200, responseTimeMs }
            : { demo: true },
        durationMs:
          type === 'UPTIME' && !episode ? responseTimeMs : Math.round(50 + random() * 400),
        trigger: 'SCHEDULED',
        startedAt: new Date(day.getTime() + i * 2_000),
      });
    });
  }
  return runs;
}

/** Incidents for each episode: opened by its first failing run, resolved by the next PASS. */
function incidentsFor(site: DemoSite, index: number, runs: GeneratedRun[]) {
  return EPISODES.filter((e) => e.siteIndex === index).map((episode) => {
    // One run of each type per day, oldest first, so a day offset is an index.
    const ofType = runs.filter((r) => r.type === episode.type);
    const firstFail = DEMO_HISTORY_DAYS - 1 - episode.daysAgo[0];
    // UPTIME opens on the second failure in a row (the site goes DOWN), like the worker.
    const opening = ofType[episode.type === 'UPTIME' ? firstFail + 1 : firstFail]!;
    const closing = ofType.slice(firstFail).find((r) => r.status === 'PASS') ?? null;
    return {
      siteId: site._id,
      ownerId: site.ownerId,
      type: episode.type,
      summary:
        episode.type === 'UPTIME'
          ? `${site.domain} is down: Demo data: ${episode.message}.`
          : `${episode.type} check failed for ${site.domain}: Demo data: ${episode.message}.`,
      openedAt: opening.startedAt,
      resolvedAt: closing?.startedAt ?? null,
      openingRunId: opening._id,
      closingRunId: closing?._id ?? null,
    };
  });
}

/** Writes the generated runs and incidents and brings each site's summary up to date. */
export async function seedDemoHistory(sites: readonly DemoSite[], now: Date) {
  let runCount = 0;
  let incidentCount = 0;
  for (const [index, site] of sites.entries()) {
    const runs = generateRuns(site, index, now);
    const incidents = incidentsFor(site, index, runs);
    await CheckRunModel.insertMany(runs);
    if (incidents.length) await IncidentModel.insertMany(incidents);
    runCount += runs.length;
    incidentCount += incidents.length;

    const latest = runs.slice(-CHECK_TYPES.length); // the last day's run of each check
    const score = overallScore(latest);
    const uptime = latest.find((r) => r.type === 'UPTIME')!;
    await SiteModel.updateOne(
      { _id: site._id },
      {
        $set: {
          currentScore: score,
          currentGrade: score === null ? null : gradeFor(score),
          status: uptime.raw.up ? 'UP' : 'DEGRADED',
          lastCheckedAt: uptime.startedAt,
        },
      },
    );
  }
  return { runs: runCount, incidents: incidentCount };
}

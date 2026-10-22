import {
  CHECK_INTERVAL_LABELS,
  CHECK_TYPES,
  CHECK_TYPE_LABELS,
  CHECK_WEIGHTS,
  SEVERITIES,
  type CheckRun,
  type CheckStatus,
  type CheckType,
  type Grade,
  type Incident,
  type ScoreHistoryPoint,
  type Severity,
  type Site,
  type SiteStatus,
} from '@sitesentinel/shared';

export interface ReportCheck {
  type: CheckType;
  label: string;
  /** Share of the overall score, in percent. */
  weight: number;
  /** null when the check has never run. */
  status: CheckStatus | null;
  score: number | null;
  checkedAt: Date | null;
}

export interface ReportFinding {
  check: string;
  severity: Severity;
  message: string;
  recommendation: string;
}

export interface ReportIncident {
  check: string;
  summary: string;
  openedAt: Date;
}

/** Everything the one-page report shows, already ordered and labelled. */
export interface SiteReport {
  generatedAt: Date;
  site: {
    displayName: string;
    domain: string;
    grade: Grade | null;
    score: number | null;
    status: SiteStatus;
    interval: string;
    lastCheckedAt: Date | null;
    verified: boolean;
    paused: boolean;
    demo: boolean;
  };
  checks: ReportCheck[];
  /** Actionable findings (not `info`), most severe first, then by check weight. */
  findings: ReportFinding[];
  trend: ScoreHistoryPoint[];
  openIncidents: ReportIncident[];
}

export interface ReportInput {
  site: Site;
  latestRuns: readonly CheckRun[];
  history: readonly ScoreHistoryPoint[];
  openIncidents: readonly Incident[];
  generatedAt: Date;
}

const severityRank = (s: Severity) => SEVERITIES.indexOf(s);

export function buildSiteReport({
  site,
  latestRuns,
  history,
  openIncidents,
  generatedAt,
}: ReportInput): SiteReport {
  const byType = new Map(latestRuns.map((run) => [run.type, run]));

  const checks = CHECK_TYPES.map((type): ReportCheck => {
    const run = byType.get(type);
    return {
      type,
      label: CHECK_TYPE_LABELS[type],
      weight: CHECK_WEIGHTS[type],
      status: run?.status ?? null,
      score: run && run.status !== 'ERROR' ? run.score : null,
      checkedAt: run ? new Date(run.startedAt) : null,
    };
  });

  // An ERROR run's findings describe why the checker couldn't run, not the site.
  const findings = latestRuns
    .filter((run) => run.status !== 'ERROR')
    .flatMap((run) =>
      run.findings
        .filter((f) => f.severity !== 'info')
        .map((f) => ({ ...f, type: run.type, check: CHECK_TYPE_LABELS[run.type] })),
    )
    .sort(
      (a, b) =>
        severityRank(b.severity) - severityRank(a.severity) ||
        CHECK_WEIGHTS[b.type] - CHECK_WEIGHTS[a.type],
    )
    .map(({ check, severity, message, recommendation }) => ({
      check,
      severity,
      message,
      recommendation,
    }));

  return {
    generatedAt,
    site: {
      displayName: site.displayName,
      domain: site.domain,
      grade: site.currentGrade,
      score: site.currentScore,
      status: site.status,
      interval: CHECK_INTERVAL_LABELS[site.checkIntervalMinutes],
      lastCheckedAt: site.lastCheckedAt ? new Date(site.lastCheckedAt) : null,
      verified: Boolean(site.verification.verifiedAt),
      paused: site.paused,
      demo: site.demo,
    },
    checks,
    findings,
    trend: [...history],
    openIncidents: openIncidents.map((i) => ({
      check: CHECK_TYPE_LABELS[i.type],
      summary: i.summary,
      openedAt: new Date(i.openedAt),
    })),
  };
}

/** `sitesentinel-example.com-2026-10-22.pdf`; domains are already normalised ASCII. */
export function reportFilename(domain: string, generatedAt: Date): string {
  const safe = domain.replace(/[^a-z0-9.-]/gi, '_');
  return `sitesentinel-${safe}-${generatedAt.toISOString().slice(0, 10)}.pdf`;
}

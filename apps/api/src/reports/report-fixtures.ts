import type {
  CheckRun,
  CheckStatus,
  CheckType,
  Incident,
  Severity,
  Site,
} from '@sitesentinel/shared';

/** Fixed "now" for report tests. */
export const NOW = new Date('2026-10-22T09:00:00.000Z');

export function siteFixture(overrides: Partial<Site> = {}): Site {
  return {
    id: '6712f0c2a1b2c3d4e5f60718',
    domain: 'example.com',
    displayName: 'Example',
    verification: { method: 'DNS_TXT', token: 'token', verifiedAt: NOW.toISOString() },
    checkIntervalMinutes: 60,
    paused: false,
    tags: [],
    currentScore: 84,
    currentGrade: 'B',
    lastCheckedAt: NOW.toISOString(),
    status: 'UP',
    demo: false,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

export const finding = (severity: Severity, message: string, recommendation = 'Fix it.') => ({
  code: message.toUpperCase().replace(/\W+/g, '_'),
  severity,
  message,
  recommendation,
});

export function runFixture(
  type: CheckType,
  status: CheckStatus,
  score: number,
  findings: CheckRun['findings'] = [],
): CheckRun {
  return {
    id: `run-${type}`,
    siteId: '6712f0c2a1b2c3d4e5f60718',
    type,
    status,
    score,
    findings,
    raw: {},
    durationMs: 10,
    trigger: 'SCHEDULED',
    startedAt: NOW.toISOString(),
  };
}

export function incidentFixture(overrides: Partial<Incident> = {}): Incident {
  return {
    id: 'incident-1',
    siteId: '6712f0c2a1b2c3d4e5f60718',
    site: { domain: 'example.com', displayName: 'Example' },
    type: 'TLS',
    summary: 'TLS certificate check failed',
    openedAt: NOW.toISOString(),
    resolvedAt: null,
    openingRunId: 'run-TLS',
    closingRunId: null,
    ...overrides,
  };
}

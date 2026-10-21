import type { CheckRun, Incident, Site } from '@sitesentinel/shared';

/** A verified, scored site; override what a test cares about. */
export function makeSite(overrides: Partial<Site> = {}): Site {
  return {
    id: '6712f0c2a1b2c3d4e5f60718',
    domain: 'example.com',
    displayName: 'Example',
    verification: {
      method: 'DNS_TXT',
      token: 'abc123',
      verifiedAt: '2026-10-01T00:00:00.000Z',
    },
    checkIntervalMinutes: 60,
    paused: false,
    tags: [],
    currentScore: 92,
    currentGrade: 'A',
    lastCheckedAt: '2026-10-21T08:00:00.000Z',
    status: 'UP',
    demo: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-21T08:00:00.000Z',
    ...overrides,
  };
}

export function makeRun(overrides: Partial<CheckRun> = {}): CheckRun {
  return {
    id: 'run1',
    siteId: '6712f0c2a1b2c3d4e5f60718',
    type: 'TLS',
    status: 'PASS',
    score: 100,
    findings: [],
    raw: {},
    durationMs: 120,
    trigger: 'SCHEDULED',
    startedAt: '2026-10-21T08:00:00.000Z',
    ...overrides,
  };
}

export function makeIncident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: 'inc1',
    siteId: '6712f0c2a1b2c3d4e5f60718',
    site: { domain: 'example.com', displayName: 'Example' },
    type: 'TLS',
    summary: 'Certificate expired',
    openedAt: '2026-10-20T08:00:00.000Z',
    resolvedAt: null,
    openingRunId: 'run1',
    closingRunId: null,
    ...overrides,
  };
}

export const page = <T>(data: T[], nextCursor: string | null = null) => ({
  data,
  pageInfo: { nextCursor, hasNextPage: nextCursor !== null },
});

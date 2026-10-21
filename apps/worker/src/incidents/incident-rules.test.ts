import type { CheckStatus, CheckType, SiteStatus } from '@sitesentinel/shared';
import { incidentAction, type IncidentAction } from './incident-rules.js';

type Row = [boolean, CheckType, CheckStatus, SiteStatus, IncidentAction];

describe('incidentAction', () => {
  it.each<Row>([
    // No open incident: only a move to FAIL opens one.
    [false, 'TLS', 'PASS', 'UP', 'NONE'],
    [false, 'TLS', 'WARN', 'UP', 'NONE'],
    [false, 'TLS', 'FAIL', 'UP', 'OPEN'],
    [false, 'SECURITY_HEADERS', 'FAIL', 'UNKNOWN', 'OPEN'],
    // Already open: further failures are the same incident, no new one (no alert storms).
    [true, 'TLS', 'FAIL', 'UP', 'NONE'],
    [true, 'TLS', 'WARN', 'UP', 'NONE'],
    [true, 'TLS', 'PASS', 'UP', 'RESOLVE'],
    // ERROR means we couldn't check: it never opens or resolves anything.
    [false, 'TLS', 'ERROR', 'UP', 'NONE'],
    [true, 'TLS', 'ERROR', 'UP', 'NONE'],
    [false, 'UPTIME', 'ERROR', 'DOWN', 'NONE'],
    // UPTIME opens on DOWN (2 failures in a row), not on a single failed request.
    [false, 'UPTIME', 'FAIL', 'DEGRADED', 'NONE'],
    [false, 'UPTIME', 'FAIL', 'DOWN', 'OPEN'],
    [false, 'UPTIME', 'WARN', 'DEGRADED', 'NONE'],
    [true, 'UPTIME', 'FAIL', 'DOWN', 'NONE'],
    [true, 'UPTIME', 'WARN', 'DEGRADED', 'NONE'],
    [true, 'UPTIME', 'PASS', 'UP', 'RESOLVE'],
  ])('open=%s %s %s (site %s) → %s', (hasOpenIncident, type, runStatus, siteStatus, expected) => {
    expect(incidentAction({ hasOpenIncident, type, runStatus, siteStatus })).toBe(expected);
  });
});

import { CHECK_TYPES } from '@sitesentinel/shared';
import { buildSiteReport, reportFilename } from './report-model.js';
import { NOW, finding, incidentFixture, runFixture, siteFixture } from './report-fixtures.js';

const build = (overrides: Partial<Parameters<typeof buildSiteReport>[0]> = {}) =>
  buildSiteReport({
    site: siteFixture(),
    latestRuns: [],
    history: [],
    openIncidents: [],
    generatedAt: NOW,
    ...overrides,
  });

describe('buildSiteReport', () => {
  it('lists every check in a fixed order, including ones that never ran', () => {
    const report = build({ latestRuns: [runFixture('UPTIME', 'PASS', 100)] });

    expect(report.checks.map((c) => c.type)).toEqual([...CHECK_TYPES]);
    expect(report.checks.find((c) => c.type === 'UPTIME')).toEqual({
      type: 'UPTIME',
      label: 'Uptime',
      weight: 10,
      status: 'PASS',
      score: 100,
      checkedAt: NOW,
    });
    expect(report.checks.find((c) => c.type === 'TLS')).toMatchObject({
      status: null,
      score: null,
      checkedAt: null,
    });
  });

  it("shows an ERROR run's status but not its score or findings", () => {
    const report = build({
      latestRuns: [runFixture('EMAIL_DNS', 'ERROR', 0, [finding('high', 'DNS timed out')])],
    });

    expect(report.checks.find((c) => c.type === 'EMAIL_DNS')).toMatchObject({
      status: 'ERROR',
      score: null,
    });
    expect(report.findings).toEqual([]);
  });

  it('keeps actionable findings, most severe first, then by check weight', () => {
    const report = build({
      latestRuns: [
        runFixture('SECURITY_TXT', 'WARN', 80, [finding('low', 'No security.txt')]),
        runFixture('SECURITY_HEADERS', 'FAIL', 40, [
          finding('info', 'Server header present'),
          finding('high', 'No CSP'),
          finding('low', 'No Permissions-Policy'),
        ]),
        runFixture('TLS', 'WARN', 80, [finding('high', 'Expires soon', 'Renew it.')]),
      ],
    });

    expect(report.findings.map((f) => [f.check, f.severity, f.message])).toEqual([
      ['TLS certificate', 'high', 'Expires soon'],
      ['Security headers', 'high', 'No CSP'],
      ['Security headers', 'low', 'No Permissions-Policy'],
      ['security.txt', 'low', 'No security.txt'],
    ]);
    expect(report.findings[0]?.recommendation).toBe('Renew it.');
  });

  it('describes the site and its open incidents', () => {
    const report = build({
      site: siteFixture({
        demo: true,
        paused: true,
        checkIntervalMinutes: 1440,
        lastCheckedAt: null,
      }),
      openIncidents: [incidentFixture()],
    });

    expect(report.site).toEqual({
      displayName: 'Example',
      domain: 'example.com',
      grade: 'B',
      score: 84,
      status: 'UP',
      interval: 'Daily',
      lastCheckedAt: null,
      verified: true,
      paused: true,
      demo: true,
    });
    expect(report.openIncidents).toEqual([
      { check: 'TLS certificate', summary: 'TLS certificate check failed', openedAt: NOW },
    ]);
  });
});

describe('reportFilename', () => {
  it('names the file after the domain and day', () => {
    expect(reportFilename('xn--bcher-kva.example', NOW)).toBe(
      'sitesentinel-xn--bcher-kva.example-2026-10-22.pdf',
    );
  });

  it('never lets a header-breaking character through', () => {
    expect(reportFilename('a"b\r\nc', NOW)).toBe('sitesentinel-a_b__c-2026-10-22.pdf');
  });
});

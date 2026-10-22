import { buildSiteReport } from './report-model.js';
import { pdfSafe, renderReportPdf, trendFloor } from './report-pdf.js';
import { NOW, finding, incidentFixture, runFixture, siteFixture } from './report-fixtures.js';

/** Page objects in the file (pdfkit writes the page tree uncompressed). */
const pageCount = (pdf: Buffer) => pdf.toString('latin1').match(/\/Type \/Page\b(?!s)/g)?.length;

describe('pdfSafe', () => {
  it('keeps Latin-1 and the extra WinAnsi punctuation', () => {
    expect(pdfSafe('Café – “quoted” … €5')).toBe('Café – “quoted” … €5');
  });

  it('replaces characters the built-in fonts cannot draw', () => {
    expect(pdfSafe('Shop 🚀 日本')).toBe('Shop ? ??');
  });

  it('drops control characters but keeps newlines', () => {
    expect(pdfSafe('a\u0000b\tc\nd\u0085')).toBe('ab c\nd');
  });
});

describe('trendFloor', () => {
  it.each([
    [[100, 95], 50],
    [[72, 90], 50],
    [[55], 40],
    [[31, 80], 20],
    [[5], 0],
    [[0], 0],
  ])('%j -> %i', (scores, floor) => {
    expect(trendFloor(scores)).toBe(floor);
  });
});

describe('renderReportPdf', () => {
  it('renders a titled PDF', async () => {
    const pdf = await renderReportPdf(
      buildSiteReport({
        site: siteFixture(),
        latestRuns: [runFixture('TLS', 'PASS', 100)],
        history: [{ date: '2026-10-22', score: 100, grade: 'A' }],
        openIncidents: [],
        generatedAt: NOW,
      }),
    );
    const text = pdf.toString('latin1');

    expect(text.startsWith('%PDF-')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('(SiteSentinel report: example.com)');
    expect(text).toContain('(D:20261022090000Z)');
    expect(pageCount(pdf)).toBe(1);
  });

  it('stays on one page however much there is to say', async () => {
    const long = 'A very long sentence that wraps across several lines of the page. '.repeat(8);
    const report = buildSiteReport({
      site: siteFixture({ displayName: long, demo: true, paused: true }),
      latestRuns: [
        runFixture(
          'SECURITY_HEADERS',
          'FAIL',
          0,
          Array.from({ length: 50 }, (_, i) => finding('high', `${i} ${long}`, long)),
        ),
      ],
      history: Array.from({ length: 90 }, (_, i) => ({
        date: `2026-07-${String((i % 28) + 1).padStart(2, '0')}`,
        score: i % 7 === 0 ? null : (i * 13) % 101,
        grade: null,
      })),
      openIncidents: Array.from({ length: 20 }, () => incidentFixture({ summary: long })),
      generatedAt: NOW,
    });

    expect(pageCount(await renderReportPdf(report))).toBe(1);
  });

  it('renders a site with no results yet', async () => {
    const report = buildSiteReport({
      site: siteFixture({
        currentGrade: null,
        currentScore: null,
        verification: { method: null, token: 't', verifiedAt: null },
      }),
      latestRuns: [],
      history: [{ date: '2026-10-22', score: null, grade: null }],
      openIncidents: [],
      generatedAt: NOW,
    });

    expect(pageCount(await renderReportPdf(report))).toBe(1);
  });
});

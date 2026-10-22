import {
  CHECK_STATUS_LABELS,
  GRADE_THRESHOLDS,
  SITE_STATUS_LABELS,
  type CheckStatus,
  type Grade,
  type Severity,
} from '@sitesentinel/shared';
import PDFDocument from 'pdfkit';
import type { SiteReport } from './report-model.js';

// A4 in points, laid out top to bottom with fixed section heights so the
// report always fits on one page; findings fill whatever space is left.
const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 48;
const LEFT = MARGIN;
const WIDTH = PAGE.width - 2 * MARGIN;
const FOOTER_Y = PAGE.height - 40;
/** Findings stop above this line, leaving room for the "N more" note. */
const CONTENT_BOTTOM = FOOTER_Y - 30;

const FONT = 'Helvetica';
const BOLD = 'Helvetica-Bold';

// The web app's light-theme colours, so the report and the dashboard match.
const COLORS = {
  text: '#111827',
  muted: '#4b5563',
  border: '#e5e7eb',
  stripe: '#f9fafb',
  notice: '#eff6ff',
  noticeText: '#1e3a8a',
  line: '#1d4ed8',
  ungraded: '#6b7280',
};
const GRADE_COLORS: Record<Grade, string> = {
  A: '#15803d',
  B: '#4d7c0f',
  C: '#a16207',
  D: '#c2410c',
  F: '#b91c1c',
};
const STATUS_COLORS: Record<CheckStatus, string> = {
  PASS: '#15803d',
  WARN: '#b45309',
  FAIL: '#b91c1c',
  ERROR: '#4b5563',
};
const SEVERITY_COLORS: Record<Severity, string> = {
  high: '#b91c1c',
  medium: '#b45309',
  low: '#1d4ed8',
  info: '#4b5563',
};

/** Characters the standard PDF fonts (WinAnsi) can draw beyond Latin-1. */
const WIN_ANSI_EXTRAS = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');

/**
 * Makes user-supplied text drawable with the built-in fonts: anything outside
 * WinAnsi (emoji, CJK, ...) becomes '?' instead of garbage glyphs, and control
 * characters other than newlines are dropped.
 */
export function pdfSafe(text: string): string {
  return Array.from(text.normalize('NFC'), (ch) => {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === '\n') return ch;
    if (code < 0x20 || (code >= 0x7f && code < 0xa0)) return ch === '\t' ? ' ' : '';
    if (code <= 0xff || WIN_ANSI_EXTRAS.has(ch)) return ch;
    return '?';
  }).join('');
}

const dateTime = (date: Date) => `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
const day = (date: Date) => date.toISOString().slice(0, 10);

type Doc = PDFKit.PDFDocument;

/** Clipped text: never wraps past `lines` lines, so a long value can't push the layout. */
function clipped(doc: Doc, text: string, x: number, y: number, width: number, lines = 1): number {
  const lineHeight = doc.currentLineHeight(true);
  const height = Math.min(doc.heightOfString(pdfSafe(text), { width }), lines * lineHeight);
  doc.text(pdfSafe(text), x, y, { width, height: height + 1, ellipsis: true });
  return height;
}

function heading(doc: Doc, text: string, y: number): number {
  doc.font(BOLD).fontSize(11).fillColor(COLORS.text).text(text, LEFT, y, { lineBreak: false });
  return y + 18;
}

function drawHeader(doc: Doc, report: SiteReport): number {
  const { site } = report;
  const badge = 72;
  const textWidth = WIDTH - badge - 16;

  doc.font(BOLD).fontSize(8).fillColor(COLORS.muted);
  doc.text('SITESENTINEL SECURITY REPORT', LEFT, MARGIN, { characterSpacing: 1, lineBreak: false });
  doc.font(BOLD).fontSize(20).fillColor(COLORS.text);
  clipped(doc, site.displayName, LEFT, MARGIN + 16, textWidth);
  doc.font(FONT).fontSize(12).fillColor(COLORS.muted);
  clipped(doc, site.domain, LEFT, MARGIN + 42, textWidth);
  doc.fontSize(9).text(`Generated ${dateTime(report.generatedAt)}`, LEFT, MARGIN + 60, {
    lineBreak: false,
  });

  const x = LEFT + WIDTH - badge;
  doc
    .roundedRect(x, MARGIN, badge, badge, 8)
    .fill(site.grade ? GRADE_COLORS[site.grade] : COLORS.ungraded);
  doc.font(BOLD).fontSize(34).fillColor('#ffffff');
  doc.text(site.grade ?? '–', x, MARGIN + 10, { width: badge, align: 'center', lineBreak: false });
  doc.font(FONT).fontSize(9);
  doc.text(site.score === null ? 'Not scored' : `${site.score} / 100`, x, MARGIN + 52, {
    width: badge,
    align: 'center',
    lineBreak: false,
  });
  return MARGIN + badge + 14;
}

function drawNotice(doc: Doc, report: SiteReport, y: number): number {
  const { site } = report;
  const notes = [
    site.demo &&
      'Demo data: a well-known public site with generated history, checked once a day with passive checks only.',
    !site.demo &&
      !site.verified &&
      'Ownership not verified: SiteSentinel does not check this site until it is verified.',
    site.paused && 'Monitoring is paused: results below may be out of date.',
  ].filter((note): note is string => Boolean(note));
  if (notes.length === 0) return y;

  doc.font(FONT).fontSize(9);
  const text = notes.join(' ');
  const height = Math.min(doc.heightOfString(text, { width: WIDTH - 20 }), 24) + 12;
  doc.rect(LEFT, y, WIDTH, height).fill(COLORS.notice);
  doc.fillColor(COLORS.noticeText);
  clipped(doc, text, LEFT + 10, y + 6, WIDTH - 20, 2);
  return y + height + 12;
}

function drawFacts(doc: Doc, report: SiteReport, y: number): number {
  const { site } = report;
  const facts: [string, string][] = [
    ['Status', SITE_STATUS_LABELS[site.status]],
    ['Checked', site.interval],
    ['Last checked', site.lastCheckedAt ? dateTime(site.lastCheckedAt) : 'Never'],
    ['Open incidents', String(report.openIncidents.length)],
  ];
  const column = WIDTH / facts.length;
  facts.forEach(([label, value], i) => {
    const x = LEFT + i * column;
    doc.font(FONT).fontSize(8).fillColor(COLORS.muted).text(label, x, y, { lineBreak: false });
    doc.font(BOLD).fontSize(10.5).fillColor(COLORS.text);
    clipped(doc, value, x, y + 12, column - 8);
  });
  return y + 40;
}

function drawChecks(doc: Doc, report: SiteReport, y: number): number {
  y = heading(doc, 'Checks', y);
  const columns = [
    { title: 'CHECK', x: 0, width: 170 },
    { title: 'WEIGHT', x: 170, width: 60 },
    { title: 'RESULT', x: 230, width: 90 },
    { title: 'SCORE', x: 320, width: 60 },
    { title: 'LAST RUN', x: 380, width: WIDTH - 380 },
  ] as const;
  const rowHeight = 18;

  doc.font(BOLD).fontSize(7.5).fillColor(COLORS.muted);
  for (const c of columns) doc.text(c.title, LEFT + c.x + 6, y, { lineBreak: false });
  y += 13;

  report.checks.forEach((check, i) => {
    if (i % 2 === 0) doc.rect(LEFT, y, WIDTH, rowHeight).fill(COLORS.stripe);
    const textY = y + 5;
    const cell = (index: number, text: string, color = COLORS.text, font = FONT) => {
      const c = columns[index]!;
      doc.font(font).fontSize(9).fillColor(color);
      doc.text(text, LEFT + c.x + 6, textY, { width: c.width - 12, lineBreak: false });
    };
    cell(0, check.label, COLORS.text, BOLD);
    cell(1, `${check.weight}%`, COLORS.muted);
    cell(
      2,
      check.status ? CHECK_STATUS_LABELS[check.status] : 'Not run yet',
      check.status ? STATUS_COLORS[check.status] : COLORS.muted,
      check.status ? BOLD : FONT,
    );
    cell(3, check.score === null ? '–' : String(check.score));
    cell(4, check.checkedAt ? dateTime(check.checkedAt) : '–', COLORS.muted);
    y += rowHeight;
  });
  return y + 16;
}

function drawTrend(doc: Doc, report: SiteReport, y: number): number {
  y = heading(doc, `Score, last ${report.trend.length} days`, y);
  const scored = report.trend.filter((p) => p.score !== null);
  if (scored.length === 0) {
    doc.font(FONT).fontSize(9).fillColor(COLORS.muted).text('No scores yet.', LEFT, y);
    return y + 26;
  }

  const height = 72;
  const axis = 22;
  const chartX = LEFT + axis;
  const chartWidth = WIDTH - axis;
  const floor = trendFloor(scored.map((p) => p.score ?? 0));
  const yFor = (score: number) => y + height - ((score - floor) / (100 - floor)) * height;

  // Grade boundaries as gridlines, labelled with the grade they start.
  doc.lineWidth(0.5).strokeColor(COLORS.border);
  doc.font(FONT).fontSize(7).fillColor(COLORS.muted);
  const gridlines = [...GRADE_THRESHOLDS.filter(([, min]) => min > floor), ['', floor] as const];
  for (const [grade, min] of gridlines) {
    doc
      .moveTo(chartX, yFor(min))
      .lineTo(chartX + chartWidth, yFor(min))
      .stroke();
    doc.text(grade || String(min), LEFT, yFor(min) - 3, {
      width: axis - 6,
      align: 'right',
      lineBreak: false,
    });
  }

  const step = report.trend.length > 1 ? chartWidth / (report.trend.length - 1) : 0;
  const points = report.trend.map((p, i) =>
    p.score === null ? null : ([chartX + i * step, yFor(p.score)] as const),
  );
  doc.lineWidth(1.5).strokeColor(COLORS.line).fillColor(COLORS.line);
  points.forEach((point, i) => {
    if (!point) return;
    const previous = points[i - 1];
    if (previous)
      doc
        .moveTo(...previous)
        .lineTo(...point)
        .stroke();
    else if (!points[i + 1]) doc.circle(point[0], point[1], 1.8).fill();
  });

  const first = report.trend[0];
  const last = report.trend.at(-1);
  doc.font(FONT).fontSize(7).fillColor(COLORS.muted);
  if (first) doc.text(first.date, chartX, y + height + 4, { lineBreak: false });
  if (last) {
    doc.text(last.date, chartX, y + height + 4, {
      width: chartWidth,
      align: 'right',
      lineBreak: false,
    });
  }
  return y + height + 24;
}

/**
 * Bottom of the trend chart's y axis: 10 points below the lowest score, at
 * most 50, so ordinary scores (60-100) use the chart's height instead of its
 * top third, and the grade gridlines stay apart.
 */
export function trendFloor(scores: readonly number[]): number {
  const lowest = Math.min(...scores);
  return Math.max(0, Math.min(50, Math.floor((lowest - 10) / 10) * 10));
}

/** The most incidents listed; the facts row has the total. */
const MAX_INCIDENTS = 3;

function drawIncidents(doc: Doc, report: SiteReport, y: number): number {
  y = heading(doc, 'Open incidents', y);
  doc.font(FONT).fontSize(9).fillColor(COLORS.text);
  if (report.openIncidents.length === 0) {
    doc.fillColor(COLORS.muted).text('None.', LEFT, y, { lineBreak: false });
    return y + 24;
  }
  for (const incident of report.openIncidents.slice(0, MAX_INCIDENTS)) {
    const text = `${incident.check}: ${incident.summary} (since ${day(incident.openedAt)})`;
    y += clipped(doc, `• ${text}`, LEFT, y, WIDTH) + 4;
  }
  const more = report.openIncidents.length - MAX_INCIDENTS;
  if (more > 0) {
    doc.fillColor(COLORS.muted).text(`and ${more} more`, LEFT, y, { lineBreak: false });
    y += 14;
  }
  return y + 10;
}

function drawFindings(doc: Doc, report: SiteReport, y: number): number {
  y = heading(doc, 'Findings and recommendations', y);
  if (report.findings.length === 0) {
    doc.font(FONT).fontSize(9).fillColor(COLORS.muted);
    doc.text('No issues in the latest results.', LEFT, y, { lineBreak: false });
    return y + 14;
  }

  let shown = 0;
  for (const finding of report.findings) {
    doc.font(BOLD).fontSize(9);
    const title = `${finding.check}: ${finding.message}`;
    const titleHeight = Math.min(
      doc.heightOfString(pdfSafe(title), { width: WIDTH - 56 }),
      2 * doc.currentLineHeight(true),
    );
    doc.font(FONT).fontSize(8.5);
    const adviceHeight = Math.min(
      doc.heightOfString(pdfSafe(finding.recommendation), { width: WIDTH - 56 }),
      3 * doc.currentLineHeight(true),
    );
    if (y + titleHeight + adviceHeight + 8 > CONTENT_BOTTOM) break;

    doc.font(BOLD).fontSize(7).fillColor(SEVERITY_COLORS[finding.severity]);
    doc.text(finding.severity.toUpperCase(), LEFT, y + 1.5, { width: 50, lineBreak: false });
    doc.font(BOLD).fontSize(9).fillColor(COLORS.text);
    clipped(doc, title, LEFT + 56, y, WIDTH - 56, 2);
    doc.font(FONT).fontSize(8.5).fillColor(COLORS.muted);
    clipped(doc, finding.recommendation, LEFT + 56, y + titleHeight + 1, WIDTH - 56, 3);
    y += titleHeight + adviceHeight + 8;
    shown += 1;
  }

  const more = report.findings.length - shown;
  if (more > 0) {
    doc.font(FONT).fontSize(8.5).fillColor(COLORS.muted);
    doc.text(
      `and ${more} more finding${more === 1 ? '' : 's'}; see the site in SiteSentinel.`,
      LEFT,
      y,
      { lineBreak: false },
    );
    y += 14;
  }
  return y;
}

function drawFooter(doc: Doc): void {
  doc.lineWidth(0.5).strokeColor(COLORS.border);
  doc
    .moveTo(LEFT, FOOTER_Y - 6)
    .lineTo(LEFT + WIDTH, FOOTER_Y - 6)
    .stroke();
  doc.font(FONT).fontSize(7).fillColor(COLORS.muted);
  doc.text(
    'SiteSentinel runs passive checks only: TLS handshakes, ordinary HTTPS requests and public DNS lookups, on domains whose owners have verified them.',
    LEFT,
    FOOTER_Y,
    { width: WIDTH, lineBreak: false, ellipsis: true },
  );
}

/** Renders the one-page report. Deterministic for a given report (no "now" inside). */
export function renderReportPdf(report: SiteReport): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    // A small bottom margin: the footer sits below the content area, and pdfkit
    // starts a new page when text crosses the margin.
    margins: { top: MARGIN, left: MARGIN, right: MARGIN, bottom: 16 },
    info: {
      Title: pdfSafe(`SiteSentinel report: ${report.site.domain}`),
      Author: 'SiteSentinel',
      Subject: 'Website security and health summary',
      CreationDate: report.generatedAt,
    },
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  let y = drawHeader(doc, report);
  y = drawNotice(doc, report, y);
  y = drawFacts(doc, report, y);
  y = drawChecks(doc, report, y);
  y = drawTrend(doc, report, y);
  y = drawIncidents(doc, report, y);
  drawFindings(doc, report, y);
  drawFooter(doc);
  doc.end();
  return done;
}

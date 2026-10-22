import type { Clock } from '@sitesentinel/checks';
import { toSiteDto } from '@sitesentinel/db';
import { MAX_PAGE_LIMIT } from '@sitesentinel/shared';
import type { IncidentsService } from '../incidents/incidents.service.js';
import type { ResultsService } from '../results/results.service.js';
import { findOwnedSite, type Actor } from '../sites/ownership.js';
import { buildSiteReport, reportFilename } from './report-model.js';
import { renderReportPdf } from './report-pdf.js';

/** Days of score history on the report, matching the site detail chart. */
export const REPORT_HISTORY_DAYS = 30;

export interface ReportsServiceDeps {
  results: ResultsService;
  incidents: IncidentsService;
  clock: Clock;
}

/** On-demand PDF summaries; nothing is stored, so a report is always current. */
export function createReportsService({ results, incidents, clock }: ReportsServiceDeps) {
  return {
    async siteReport(actor: Actor, siteId: string): Promise<{ filename: string; pdf: Buffer }> {
      // Ownership first: the reads below repeat it, but this one decides the 404.
      const site = toSiteDto(await findOwnedSite(actor, siteId));
      const [latest, history, open] = await Promise.all([
        results.latestRuns(actor, siteId),
        results.scoreHistory(actor, siteId, REPORT_HISTORY_DAYS),
        incidents.list(actor, { open: true, siteId, limit: MAX_PAGE_LIMIT }),
      ]);
      const generatedAt = clock.now();
      const report = buildSiteReport({
        site,
        latestRuns: latest.data,
        history: history.data,
        openIncidents: open.data,
        generatedAt,
      });
      return {
        filename: reportFilename(site.domain, generatedAt),
        pdf: await renderReportPdf(report),
      };
    },
  };
}

export type ReportsService = ReturnType<typeof createReportsService>;

import {
  bulkSitesResultSchema,
  checkNowResultSchema,
  checkRunSchema,
  latestRunsSchema,
  paginatedSchema,
  scoreHistorySchema,
  siteSchema,
  siteSummarySchema,
  type BulkSitesInput,
  type BulkSitesResult,
  type CheckNowResult,
  type CheckRun,
  type CheckType,
  type CreateSiteInput,
  type Grade,
  type Paginated,
  type ScoreHistoryPoint,
  type Site,
  type SiteSort,
  type SiteStatus,
  type SiteSummary,
  type UpdateSiteInput,
  type VerificationMethod,
} from '@sitesentinel/shared';
import { apiDownload, apiRequest, type Download } from './client';

const sitePageSchema = paginatedSchema(siteSchema);
const runPageSchema = paginatedSchema(checkRunSchema);

export interface SiteListParams {
  limit?: number;
  cursor?: string;
  grade?: Grade;
  status?: SiteStatus;
  tag?: string;
  sort?: SiteSort;
}

export interface RunListParams {
  limit?: number;
  cursor?: string;
  type?: CheckType;
  from?: string;
  to?: string;
}

/** `?a=1&b=2` from the defined, non-empty values; '' when there are none. */
export function queryString(params: object): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

const sitePath = (id: string) => `/sites/${encodeURIComponent(id)}`;

export const sitesApi = {
  list: (params: SiteListParams = {}, signal?: AbortSignal): Promise<Paginated<Site>> =>
    apiRequest('GET', `/sites${queryString(params)}`, { schema: sitePageSchema, signal }),

  summary: (signal?: AbortSignal): Promise<SiteSummary> =>
    apiRequest('GET', '/sites/summary', { schema: siteSummarySchema, signal }),

  get: (id: string, signal?: AbortSignal): Promise<Site> =>
    apiRequest('GET', sitePath(id), { schema: siteSchema, signal }),

  create: (input: CreateSiteInput): Promise<Site> =>
    apiRequest('POST', '/sites', { body: input, schema: siteSchema }),

  update: (id: string, patch: UpdateSiteInput): Promise<Site> =>
    apiRequest('PATCH', sitePath(id), { body: patch, schema: siteSchema }),

  remove: (id: string): Promise<void> => apiRequest('DELETE', sitePath(id)),

  /** Rejects with a 422 ApiError whose `extensions.attempts` explains each method tried. */
  verify: (id: string, method?: VerificationMethod): Promise<Site> =>
    apiRequest('POST', `${sitePath(id)}/verify`, {
      body: method ? { method } : {},
      schema: siteSchema,
    }),

  checkNow: (id: string): Promise<CheckNowResult> =>
    apiRequest('POST', `${sitePath(id)}/check-now`, { schema: checkNowResultSchema }),

  bulk: (input: BulkSitesInput): Promise<BulkSitesResult> =>
    apiRequest('POST', '/sites/bulk', { body: input, schema: bulkSitesResultSchema }),

  runs: (
    id: string,
    params: RunListParams = {},
    signal?: AbortSignal,
  ): Promise<Paginated<CheckRun>> =>
    apiRequest('GET', `${sitePath(id)}/runs${queryString(params)}`, {
      schema: runPageSchema,
      signal,
    }),

  latestRuns: async (id: string, signal?: AbortSignal): Promise<CheckRun[]> =>
    (await apiRequest('GET', `${sitePath(id)}/runs/latest`, { schema: latestRunsSchema, signal }))
      .data,

  /** The one-page PDF summary, generated on demand. */
  report: (id: string): Promise<Download> =>
    apiDownload(`${sitePath(id)}/report.pdf`, 'application/pdf'),

  scoreHistory: async (id: string, days = 30, signal?: AbortSignal): Promise<ScoreHistoryPoint[]> =>
    (
      await apiRequest('GET', `${sitePath(id)}/score-history?days=${days}`, {
        schema: scoreHistorySchema,
        signal,
      })
    ).data,
};

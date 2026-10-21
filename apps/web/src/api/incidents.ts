import {
  incidentSchema,
  paginatedSchema,
  type Incident,
  type Paginated,
} from '@sitesentinel/shared';
import { apiRequest } from './client';
import { queryString } from './sites';

const incidentPageSchema = paginatedSchema(incidentSchema);

export interface IncidentListParams {
  limit?: number;
  cursor?: string;
  /** true: only open; false: only resolved; omitted: both. */
  open?: boolean;
  siteId?: string;
}

export const incidentsApi = {
  list: (params: IncidentListParams = {}, signal?: AbortSignal): Promise<Paginated<Incident>> =>
    apiRequest('GET', `/incidents${queryString(params)}`, { schema: incidentPageSchema, signal }),
};

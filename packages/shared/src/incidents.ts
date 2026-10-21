import { z } from 'zod';
import { checkTypeSchema } from './enums.js';
import { objectIdSchema } from './ids.js';
import { paginationQuerySchema } from './pagination.js';

export const incidentSchema = z.object({
  id: z.string(),
  siteId: z.string(),
  /** Enough of the site to label the incident in a list. */
  site: z.object({ domain: z.string(), displayName: z.string() }),
  /** The check that failed; UPTIME incidents mean the site went DOWN. */
  type: checkTypeSchema,
  summary: z.string(),
  openedAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().nullable(),
  openingRunId: z.string(),
  closingRunId: z.string().nullable(),
});
export type Incident = z.infer<typeof incidentSchema>;

const booleanQuery = z.enum(['true', 'false']).transform((v) => v === 'true');

export const listIncidentsQuerySchema = paginationQuerySchema.extend({
  /** `true`: only open incidents; `false`: only resolved ones; omitted: both. */
  open: booleanQuery.optional(),
  siteId: objectIdSchema.optional(),
});
export type ListIncidentsQuery = z.infer<typeof listIncidentsQuerySchema>;

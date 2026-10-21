import { z } from 'zod';
import { checkStatusSchema, checkTypeSchema, gradeSchema, severitySchema } from './enums.js';
import { paginationQuerySchema } from './pagination.js';
import { checkTriggerSchema } from './queues.js';

/** Check runs are kept for 90 days (TTL index on `startedAt`). */
export const RUN_RETENTION_DAYS = 90;

export const findingSchema = z.object({
  code: z.string(),
  severity: severitySchema,
  message: z.string(),
  recommendation: z.string(),
});

export const checkRunSchema = z.object({
  id: z.string(),
  siteId: z.string(),
  type: checkTypeSchema,
  status: checkStatusSchema,
  score: z.number().min(0).max(100),
  findings: z.array(findingSchema),
  /** Check-specific evidence (certificate details, header values, ...), size-capped. */
  raw: z.record(z.string(), z.unknown()),
  durationMs: z.number().int().min(0),
  trigger: checkTriggerSchema,
  startedAt: z.iso.datetime(),
});
export type CheckRun = z.infer<typeof checkRunSchema>;

export const listRunsQuerySchema = paginationQuerySchema
  .extend({
    type: checkTypeSchema.optional(),
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: '`from` must not be after `to`',
    path: ['from'],
  });
export type ListRunsQuery = z.infer<typeof listRunsQuerySchema>;

/** The newest run of each check type: what the site detail page shows. */
export const latestRunsSchema = z.object({ data: z.array(checkRunSchema) });

export const scoreHistoryQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(RUN_RETENTION_DAYS).default(30),
});

export const scoreHistoryPointSchema = z.object({
  /** UTC calendar day, YYYY-MM-DD. */
  date: z.iso.date(),
  /** Overall score from the latest result of each check by the end of that day. */
  score: z.number().min(0).max(100).nullable(),
  grade: gradeSchema.nullable(),
});
export type ScoreHistoryPoint = z.infer<typeof scoreHistoryPointSchema>;

export const scoreHistorySchema = z.object({ data: z.array(scoreHistoryPointSchema) });

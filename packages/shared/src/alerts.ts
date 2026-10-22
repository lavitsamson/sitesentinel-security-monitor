import { z } from 'zod';
import { emailSchema } from './auth.js';
import { objectIdSchema } from './ids.js';
import { paginationQuerySchema } from './pagination.js';

export const ALERT_CHANNEL_TYPES = ['EMAIL', 'WEBHOOK'] as const;
export const alertChannelTypeSchema = z.enum(ALERT_CHANNEL_TYPES);
export type AlertChannelType = z.infer<typeof alertChannelTypeSchema>;

/** Most alert channels one account can have. */
export const MAX_ALERT_CHANNELS = 10;

/** Header carrying `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">` on webhook alerts. */
export const WEBHOOK_SIGNATURE_HEADER = 'X-SiteSentinel-Signature';

/**
 * https only (the body is signed, not encrypted), on the default port, with no
 * credentials in the URL. Private and internal addresses are refused when the
 * URL is saved (literal IPs) and again on every delivery (the SSRF guard).
 */
function isPlainHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && url.port === '';
  } catch {
    return false;
  }
}

export const webhookUrlSchema = z
  .string()
  .trim()
  .max(2_000)
  .refine(
    isPlainHttpsUrl,
    'Use an https:// URL on the default port, without a username or password',
  );

const channelNameSchema = z.string().trim().min(1, 'Enter a name').max(60);

/** How `target` is validated for each channel type. */
export const alertTargetSchemas = {
  EMAIL: emailSchema,
  WEBHOOK: webhookUrlSchema,
} as const satisfies Record<AlertChannelType, z.ZodType<string>>;

export const createAlertChannelSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('EMAIL'), name: channelNameSchema, target: alertTargetSchemas.EMAIL }),
  z.object({
    type: z.literal('WEBHOOK'),
    name: channelNameSchema,
    target: alertTargetSchemas.WEBHOOK,
  }),
]);
export type CreateAlertChannelInput = z.input<typeof createAlertChannelSchema>;

// The type is fixed at creation; `target` is re-validated against it by the API.
export const updateAlertChannelSchema = z
  .strictObject({
    name: channelNameSchema,
    target: z.string().trim().min(1).max(2_000),
    active: z.boolean(),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, 'Provide at least one field to update');
export type UpdateAlertChannelInput = z.input<typeof updateAlertChannelSchema>;

export const listAlertChannelsQuerySchema = paginationQuerySchema;

export const DELIVERY_STATUSES = ['PENDING', 'SENT', 'FAILED'] as const;
export const deliveryStatusSchema = z.enum(DELIVERY_STATUSES);
export type DeliveryStatus = z.infer<typeof deliveryStatusSchema>;

export const alertChannelSchema = z.object({
  id: z.string(),
  type: alertChannelTypeSchema,
  name: z.string(),
  target: z.string(),
  active: z.boolean(),
  /** Outcome of the most recent delivery (alert or test), or null if none was attempted yet. */
  lastDelivery: z
    .object({
      status: z.enum(['SENT', 'FAILED']),
      at: z.iso.datetime(),
      error: z.string().nullable(),
    })
    .nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type AlertChannel = z.infer<typeof alertChannelSchema>;

/** The create response is the only time a webhook's signing secret is shown. */
export const createdAlertChannelSchema = alertChannelSchema.extend({
  secret: z.string().nullable(),
});
export type CreatedAlertChannel = z.infer<typeof createdAlertChannelSchema>;

export const testAlertResultSchema = z.object({
  /** The test is delivered by the worker; the channel's `lastDelivery` shows the outcome. */
  status: z.literal('QUEUED'),
});
export type TestAlertResult = z.infer<typeof testAlertResultSchema>;

// --- Queue contract -----------------------------------------------------------

/** Incident transitions that send an alert. */
export const INCIDENT_EVENTS = ['OPENED', 'RESOLVED'] as const;
export const incidentEventSchema = z.enum(INCIDENT_EVENTS);
export type IncidentEvent = z.infer<typeof incidentEventSchema>;

/** What a delivery record was for: an incident transition or a test send. */
export const DELIVERY_EVENTS = [...INCIDENT_EVENTS, 'TEST'] as const;
export type DeliveryEvent = (typeof DELIVERY_EVENTS)[number];

export const alertJobSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('INCIDENT'), incidentId: objectIdSchema, event: incidentEventSchema }),
  z.object({ kind: z.literal('TEST'), channelId: objectIdSchema }),
]);
export type AlertJob = z.infer<typeof alertJobSchema>;

/** Puts alert jobs on the `alerts` queue. */
export interface AlertEnqueuer {
  enqueueAlert(job: AlertJob): Promise<void>;
}

/**
 * One job per incident transition, whatever produced it: queueing the same
 * transition twice is a no-op, so an incident never alerts twice for one change.
 */
export function incidentAlertJobId(incidentId: string, event: IncidentEvent): string {
  return [incidentId, event].join('.');
}

/**
 * Incident alerts are tried 5 times, retrying failed channels with exponential
 * backoff (30 s, 1, 2 and 4 min). Failed jobs are kept a week so the id keeps blocking re-sends.
 */
export const INCIDENT_ALERT_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { age: 7 * 24 * 3600 },
  removeOnFail: { age: 7 * 24 * 3600 },
} as const;

/** A test send is tried once: the user is watching and wants the real outcome now. */
export const TEST_ALERT_JOB_OPTIONS = {
  attempts: 1,
  removeOnComplete: { age: 3600 },
  removeOnFail: { age: 3600 },
} as const;

/** The `add` arguments for an alert job; both producers (API tests, worker incidents) use this. */
export function alertJobEntry(job: AlertJob, now: Date) {
  return job.kind === 'INCIDENT'
    ? {
        name: `incident.${job.event.toLowerCase()}`,
        data: job,
        opts: {
          ...INCIDENT_ALERT_JOB_OPTIONS,
          jobId: incidentAlertJobId(job.incidentId, job.event),
        },
      }
    : {
        name: 'test',
        data: job,
        opts: {
          ...TEST_ALERT_JOB_OPTIONS,
          jobId: ['test', job.channelId, now.getTime()].join('.'),
        },
      };
}

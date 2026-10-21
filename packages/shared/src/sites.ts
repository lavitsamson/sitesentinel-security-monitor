import { z } from 'zod';
import { domainSchema } from './domain.js';
import {
  checkIntervalSchema,
  gradeSchema,
  siteStatusSchema,
  verificationMethodSchema,
} from './enums.js';
import { paginationQuerySchema } from './pagination.js';

/** Value of the DNS TXT record that proves ownership: `sitesentinel-verify=<token>`. */
export const VERIFICATION_TXT_PREFIX = 'sitesentinel-verify=';
/** Path of the file that proves ownership; its body is the token. */
export const VERIFICATION_FILE_PATH = '/.well-known/sitesentinel-verify.txt';

export const MAX_TAGS = 20;

export const tagSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(32)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, 'Use letters, digits, - and _ only');

const tagsSchema = z
  .array(tagSchema)
  .max(MAX_TAGS)
  .transform((tags) => [...new Set(tags)]);

const displayNameSchema = z.string().trim().min(1).max(100);

export const createSiteSchema = z.object({
  domain: domainSchema,
  /** Defaults to the domain. */
  displayName: displayNameSchema.optional(),
  checkIntervalMinutes: checkIntervalSchema.default(60),
  tags: tagsSchema.default([]),
});
export type CreateSiteInput = z.input<typeof createSiteSchema>;

// Strict, so an attempt to change `domain` (which would void verification) is an error.
export const updateSiteSchema = z
  .strictObject({
    displayName: displayNameSchema,
    checkIntervalMinutes: checkIntervalSchema,
    paused: z.boolean(),
    tags: tagsSchema,
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, 'Provide at least one field to update');
export type UpdateSiteInput = z.input<typeof updateSiteSchema>;

export const SITE_SORTS = [
  'name',
  '-name',
  'score',
  '-score',
  'lastCheckedAt',
  '-lastCheckedAt',
] as const;
export type SiteSort = (typeof SITE_SORTS)[number];

export const listSitesQuerySchema = paginationQuerySchema.extend({
  grade: gradeSchema.optional(),
  status: siteStatusSchema.optional(),
  tag: tagSchema.optional(),
  /** A leading `-` sorts descending. */
  sort: z.enum(SITE_SORTS).default('name'),
});
export type ListSitesQuery = z.infer<typeof listSitesQuerySchema>;

export const verifySiteSchema = z.object({
  /** Try only this method; by default DNS TXT is tried first, then the file. */
  method: verificationMethodSchema.optional(),
});

export const verificationAttemptSchema = z.object({
  method: verificationMethodSchema,
  ok: z.boolean(),
  detail: z.string(),
});
export type VerificationAttempt = z.infer<typeof verificationAttemptSchema>;

export const siteSchema = z.object({
  id: z.string(),
  domain: z.string(),
  displayName: z.string(),
  verification: z.object({
    method: verificationMethodSchema.nullable(),
    token: z.string(),
    verifiedAt: z.iso.datetime().nullable(),
  }),
  checkIntervalMinutes: checkIntervalSchema,
  paused: z.boolean(),
  tags: z.array(z.string()),
  currentScore: z.number().min(0).max(100).nullable(),
  currentGrade: gradeSchema.nullable(),
  lastCheckedAt: z.iso.datetime().nullable(),
  status: siteStatusSchema,
  /** Seeded demo site, verified without proof. Shown with a "demo data" label. */
  demo: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Site = z.infer<typeof siteSchema>;

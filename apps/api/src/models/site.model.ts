import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import {
  GRADES,
  SITE_STATUSES,
  VERIFICATION_METHODS,
  type CheckIntervalMinutes,
  type Grade,
  type Site as SiteDto,
  type SiteStatus,
  type VerificationMethod,
} from '@sitesentinel/shared';

export interface Site {
  ownerId: Types.ObjectId;
  /** Normalised: lowercase punycode, no scheme/port/path. */
  domain: string;
  displayName: string;
  verification: {
    method: VerificationMethod | null;
    token: string;
    verifiedAt: Date | null;
    lastAttemptAt: Date | null;
    /** Failed scheduled re-verifications in a row; 3 pauses the site (milestone 4). */
    consecutiveFailures: number;
  };
  checkIntervalMinutes: CheckIntervalMinutes;
  paused: boolean;
  tags: string[];
  currentScore: number | null;
  currentGrade: Grade | null;
  lastCheckedAt: Date | null;
  status: SiteStatus;
  /** Seeded demo site, pre-verified without proof and labelled "demo data" in the UI. */
  demo: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type SiteDocument = HydratedDocument<Site>;

const siteSchema = new Schema<Site>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    domain: { type: String, required: true },
    displayName: { type: String, required: true },
    verification: {
      method: { type: String, enum: [...VERIFICATION_METHODS, null], default: null },
      token: { type: String, required: true },
      verifiedAt: { type: Date, default: null },
      lastAttemptAt: { type: Date, default: null },
      consecutiveFailures: { type: Number, default: 0 },
    },
    checkIntervalMinutes: { type: Number, required: true },
    paused: { type: Boolean, default: false },
    tags: { type: [String], default: [] },
    currentScore: { type: Number, default: null },
    currentGrade: { type: String, enum: [...GRADES, null], default: null },
    lastCheckedAt: { type: Date, default: null },
    status: { type: String, enum: SITE_STATUSES, default: 'UNKNOWN' },
    demo: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// Every query is scoped by owner, so every index starts with ownerId.
siteSchema.index({ ownerId: 1, domain: 1 }, { unique: true });
siteSchema.index({ ownerId: 1, currentGrade: 1 });
siteSchema.index({ ownerId: 1, tags: 1 });
// Keyset pagination: one index per sortable field, with _id as the tie-breaker.
siteSchema.index({ ownerId: 1, displayName: 1, _id: 1 });
siteSchema.index({ ownerId: 1, currentScore: 1, _id: 1 });
siteSchema.index({ ownerId: 1, lastCheckedAt: 1, _id: 1 });

export const SiteModel = model<Site>('Site', siteSchema);

export function toSiteDto(site: SiteDocument): SiteDto {
  const iso = (date: Date | null) => date?.toISOString() ?? null;
  return {
    id: site._id.toString(),
    domain: site.domain,
    displayName: site.displayName,
    verification: {
      method: site.verification.method,
      token: site.verification.token,
      verifiedAt: iso(site.verification.verifiedAt),
    },
    checkIntervalMinutes: site.checkIntervalMinutes,
    paused: site.paused,
    tags: [...site.tags],
    currentScore: site.currentScore,
    currentGrade: site.currentGrade,
    lastCheckedAt: iso(site.lastCheckedAt),
    status: site.status,
    demo: site.demo,
    createdAt: site.createdAt.toISOString(),
    updatedAt: site.updatedAt.toISOString(),
  };
}

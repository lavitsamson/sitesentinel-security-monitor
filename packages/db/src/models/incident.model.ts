import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import { CHECK_TYPES, type CheckType, type Incident as IncidentDto } from '@sitesentinel/shared';

export interface Incident {
  siteId: Types.ObjectId;
  ownerId: Types.ObjectId;
  /** The failing check; an UPTIME incident means the site went DOWN. */
  type: CheckType;
  summary: string;
  openedAt: Date;
  resolvedAt: Date | null;
  openingRunId: Types.ObjectId;
  closingRunId: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

export type IncidentDocument = HydratedDocument<Incident>;

const incidentSchema = new Schema<Incident>(
  {
    siteId: { type: Schema.Types.ObjectId, ref: 'Site', required: true },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: CHECK_TYPES, required: true },
    summary: { type: String, required: true },
    openedAt: { type: Date, required: true },
    resolvedAt: { type: Date, default: null },
    openingRunId: { type: Schema.Types.ObjectId, ref: 'CheckRun', required: true },
    closingRunId: { type: Schema.Types.ObjectId, ref: 'CheckRun', default: null },
  },
  { timestamps: true },
);

// Open/resolved incidents for an owner, newest first (CLAUDE.md §5).
incidentSchema.index({ ownerId: 1, resolvedAt: 1, openedAt: -1, _id: -1 });
incidentSchema.index({ ownerId: 1, openedAt: -1, _id: -1 });
// At most one open incident per site and check: a second "open" is a duplicate-key error.
incidentSchema.index(
  { siteId: 1, type: 1 },
  { unique: true, partialFilterExpression: { resolvedAt: { $type: 'null' } } },
);

export const IncidentModel = model<Incident>('Incident', incidentSchema);

/** `site` is looked up separately: incidents are deleted with their site, so it always exists. */
export function toIncidentDto(incident: IncidentDocument, site: IncidentDto['site']): IncidentDto {
  return {
    id: incident._id.toString(),
    siteId: incident.siteId.toString(),
    site: { domain: site.domain, displayName: site.displayName },
    type: incident.type,
    summary: incident.summary,
    openedAt: incident.openedAt.toISOString(),
    resolvedAt: incident.resolvedAt?.toISOString() ?? null,
    openingRunId: incident.openingRunId.toString(),
    closingRunId: incident.closingRunId?.toString() ?? null,
  };
}

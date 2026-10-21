import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import {
  CHECK_STATUSES,
  CHECK_TRIGGERS,
  CHECK_TYPES,
  RUN_RETENTION_DAYS,
  SEVERITIES,
  type CheckRun as CheckRunDto,
  type CheckStatus,
  type CheckTrigger,
  type CheckType,
  type Severity,
} from '@sitesentinel/shared';

export interface StoredFinding {
  code: string;
  severity: Severity;
  message: string;
  recommendation: string;
}

export interface CheckRun {
  siteId: Types.ObjectId;
  /** Denormalised from the site so owner-scoped queries never need a join. */
  ownerId: Types.ObjectId;
  type: CheckType;
  status: CheckStatus;
  score: number;
  findings: StoredFinding[];
  /** Check-specific evidence, capped in size by the worker before it is stored. */
  raw: Record<string, unknown>;
  durationMs: number;
  trigger: CheckTrigger;
  startedAt: Date;
}

export type CheckRunDocument = HydratedDocument<CheckRun>;

const findingSchema = new Schema<StoredFinding>(
  {
    code: { type: String, required: true },
    severity: { type: String, enum: SEVERITIES, required: true },
    message: { type: String, required: true },
    recommendation: { type: String, required: true },
  },
  { _id: false },
);

const checkRunSchema = new Schema<CheckRun>(
  {
    siteId: { type: Schema.Types.ObjectId, ref: 'Site', required: true },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: CHECK_TYPES, required: true },
    status: { type: String, enum: CHECK_STATUSES, required: true },
    score: { type: Number, required: true, min: 0, max: 100 },
    findings: { type: [findingSchema], default: [] },
    raw: { type: Schema.Types.Mixed, default: {} },
    durationMs: { type: Number, required: true, min: 0 },
    trigger: { type: String, enum: CHECK_TRIGGERS, required: true },
    startedAt: { type: Date, required: true },
  },
  // Runs are immutable facts, so there is no updatedAt; startedAt is the timestamp.
  { timestamps: false, minimize: false },
);

// Latest run per type, and per-type history (CLAUDE.md §5).
checkRunSchema.index({ siteId: 1, type: 1, startedAt: -1 });
// Run history across types, newest first, with _id as the pagination tie-breaker.
checkRunSchema.index({ siteId: 1, startedAt: -1, _id: -1 });
// Retention: MongoDB deletes runs 90 days after they started.
checkRunSchema.index({ startedAt: 1 }, { expireAfterSeconds: RUN_RETENTION_DAYS * 24 * 3600 });

export const CheckRunModel = model<CheckRun>('CheckRun', checkRunSchema);

export function toCheckRunDto(run: CheckRunDocument): CheckRunDto {
  return {
    id: run._id.toString(),
    siteId: run.siteId.toString(),
    type: run.type,
    status: run.status,
    score: run.score,
    findings: run.findings.map(({ code, severity, message, recommendation }) => ({
      code,
      severity,
      message,
      recommendation,
    })),
    raw: run.raw,
    durationMs: run.durationMs,
    trigger: run.trigger,
    startedAt: run.startedAt.toISOString(),
  };
}

import { Schema, model, type Types } from 'mongoose';

export interface AuditLog {
  ownerId: Types.ObjectId;
  /** Dotted verb, e.g. `site.create`, `site.verify`. */
  action: string;
  entityType: string;
  entityId: string;
  ip: string | null;
  createdAt: Date;
}

const auditLogSchema = new Schema<AuditLog>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    action: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: { type: String, required: true },
    ip: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
auditLogSchema.index({ ownerId: 1, createdAt: -1 });

export const AuditLogModel = model<AuditLog>('AuditLog', auditLogSchema);

export interface AuditEntry {
  ownerId: string;
  action: string;
  entityType: string;
  entityId: string;
  ip?: string | undefined;
}

export async function recordAudit(entry: AuditEntry): Promise<void> {
  await AuditLogModel.create({ ...entry, ip: entry.ip ?? null });
}

/** One write for many entries, e.g. a bulk action touching 100 sites. */
export async function recordAudits(entries: readonly AuditEntry[]): Promise<void> {
  if (!entries.length) return;
  await AuditLogModel.insertMany(entries.map((entry) => ({ ...entry, ip: entry.ip ?? null })));
}

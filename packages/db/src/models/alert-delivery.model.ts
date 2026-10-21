import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import {
  DELIVERY_EVENTS,
  DELIVERY_STATUSES,
  type DeliveryEvent,
  type DeliveryStatus,
} from '@sitesentinel/shared';

/** Delivery records are kept for 30 days (CLAUDE.md §5). */
export const DELIVERY_RETENTION_DAYS = 30;

export interface AlertDelivery {
  channelId: Types.ObjectId;
  ownerId: Types.ObjectId;
  /** Null for a test send. */
  incidentId: Types.ObjectId | null;
  event: DeliveryEvent;
  status: DeliveryStatus;
  attempts: number;
  lastError: string | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type AlertDeliveryDocument = HydratedDocument<AlertDelivery>;

const alertDeliverySchema = new Schema<AlertDelivery>(
  {
    channelId: { type: Schema.Types.ObjectId, ref: 'AlertChannel', required: true },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    incidentId: { type: Schema.Types.ObjectId, ref: 'Incident', default: null },
    event: { type: String, enum: DELIVERY_EVENTS, required: true },
    status: { type: String, enum: DELIVERY_STATUSES, required: true },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: null },
    sentAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// One record per channel per incident transition: a retried alert job finds the
// channels it already reached and skips them, so nobody is alerted twice.
alertDeliverySchema.index(
  { channelId: 1, incidentId: 1, event: 1 },
  { unique: true, partialFilterExpression: { incidentId: { $type: 'objectId' } } },
);
alertDeliverySchema.index({ incidentId: 1 });
alertDeliverySchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: DELIVERY_RETENTION_DAYS * 24 * 3600 },
);

export const AlertDeliveryModel = model<AlertDelivery>('AlertDelivery', alertDeliverySchema);

import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import {
  ALERT_CHANNEL_TYPES,
  type AlertChannel as AlertChannelDto,
  type AlertChannelType,
} from '@sitesentinel/shared';

export interface AlertChannel {
  ownerId: Types.ObjectId;
  type: AlertChannelType;
  name: string;
  /** An email address, or an https:// webhook URL. */
  target: string;
  /**
   * The webhook's HMAC signing secret, AES-256-GCM encrypted with ALERT_SECRET_KEY
   * (`encryptSecret`). Null for email channels. Never returned by the API after creation.
   */
  secret: string | null;
  active: boolean;
  lastDeliveryStatus: 'SENT' | 'FAILED' | null;
  lastDeliveryAt: Date | null;
  lastDeliveryError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type AlertChannelDocument = HydratedDocument<AlertChannel>;

const alertChannelSchema = new Schema<AlertChannel>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ALERT_CHANNEL_TYPES, required: true },
    name: { type: String, required: true },
    target: { type: String, required: true },
    secret: { type: String, default: null },
    active: { type: Boolean, default: true },
    lastDeliveryStatus: { type: String, enum: ['SENT', 'FAILED', null], default: null },
    lastDeliveryAt: { type: Date, default: null },
    lastDeliveryError: { type: String, default: null },
  },
  { timestamps: true },
);

// Listing (oldest first, keyset on _id) and the worker's "active channels of this owner".
alertChannelSchema.index({ ownerId: 1, _id: 1 });
alertChannelSchema.index({ ownerId: 1, active: 1 });

export const AlertChannelModel = model<AlertChannel>('AlertChannel', alertChannelSchema);

/** The explicit response shape: the encrypted secret never leaves the API. */
export function toAlertChannelDto(channel: AlertChannelDocument): AlertChannelDto {
  return {
    id: channel._id.toString(),
    type: channel.type,
    name: channel.name,
    target: channel.target,
    active: channel.active,
    lastDelivery:
      channel.lastDeliveryStatus && channel.lastDeliveryAt
        ? {
            status: channel.lastDeliveryStatus,
            at: channel.lastDeliveryAt.toISOString(),
            error: channel.lastDeliveryError,
          }
        : null,
    createdAt: channel.createdAt.toISOString(),
    updatedAt: channel.updatedAt.toISOString(),
  };
}

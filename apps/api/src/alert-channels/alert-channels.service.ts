import { isIP } from 'node:net';
import { isPublicAddress } from '@sitesentinel/checks';
import {
  AlertChannelModel,
  AlertDeliveryModel,
  recordAudit,
  toAlertChannelDto,
  type AlertChannelDocument,
} from '@sitesentinel/db';
import {
  MAX_ALERT_CHANNELS,
  alertTargetSchemas,
  type AlertChannel,
  type AlertChannelType,
  type AlertEnqueuer,
  type CreatedAlertChannel,
  type Paginated,
  type TestAlertResult,
  type createAlertChannelSchema,
  type listAlertChannelsQuerySchema,
  type updateAlertChannelSchema,
} from '@sitesentinel/shared';
import { encryptSecret, generateWebhookSecret } from '@sitesentinel/shared/node';
import { Types } from 'mongoose';
import { z } from 'zod';
import { decodeCursor, encodeCursor } from '../http/cursor.js';
import { HttpError } from '../http/errors.js';
import { isObjectId, notFound, type Actor } from '../sites/ownership.js';

export interface AlertChannelsServiceDeps {
  /** The `alerts` queue, for test sends; the worker delivers them. */
  alerts: AlertEnqueuer;
  /** AES-256-GCM key that webhook signing secrets are stored under. */
  secretKey: Buffer;
}

/** Cursor tag for channel pages (oldest first, keyset on _id). */
const CHANNELS_SORT = '_id';

/** Names that only ever resolve inside a network, never on the public internet. */
const INTERNAL_HOST = /(^|\.)(localhost|local|internal|home\.arpa)$/;

/**
 * A fast, friendly refusal of webhook URLs that can only point inward. It is
 * not the security boundary: every delivery resolves DNS and goes through the
 * SSRF guard, which also catches public names that resolve to private addresses.
 */
function assertPublicWebhookHost(url: string): void {
  const host = new URL(url).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const internal = isIP(host)
    ? !isPublicAddress(host)
    : !host.includes('.') || INTERNAL_HOST.test(host.replace(/\.$/, ''));
  if (internal) {
    throw new HttpError(400, 'Bad Request', 'Webhook URLs must point to a public internet host', [
      { path: 'target', message: 'Use a public https:// URL' },
    ]);
  }
}

/** Validates a target against its channel type, as on create. */
function parseTarget(type: AlertChannelType, target: string): string {
  // Wrapped so a validation error reports the `target` field, like any other 400.
  const parsed = z.object({ target: alertTargetSchemas[type] }).parse({ target }).target;
  if (type === 'WEBHOOK') assertPublicWebhookHost(parsed);
  return parsed;
}

export function createAlertChannelsService({ alerts, secretKey }: AlertChannelsServiceDeps) {
  const audit = (actor: Actor, action: string, channel: AlertChannelDocument) =>
    recordAudit({
      ownerId: actor.userId,
      action,
      entityType: 'alertChannel',
      entityId: channel.id,
      ip: actor.ip,
    });

  /** Another user's channel and a malformed id both look like a missing one (404). */
  async function findOwned(actor: Actor, channelId: string): Promise<AlertChannelDocument> {
    if (!isObjectId(channelId)) throw notFound('Alert channel');
    const channel = await AlertChannelModel.findOne({
      _id: new Types.ObjectId(channelId),
      ownerId: new Types.ObjectId(actor.userId),
    });
    if (!channel) throw notFound('Alert channel');
    return channel;
  }

  return {
    async list(
      actor: Actor,
      query: z.output<typeof listAlertChannelsQuerySchema>,
    ): Promise<Paginated<AlertChannel>> {
      const filter: Record<string, unknown> = { ownerId: new Types.ObjectId(actor.userId) };
      if (query.cursor) filter._id = { $gt: decodeCursor(query.cursor, CHANNELS_SORT).id };

      const rows = await AlertChannelModel.find(filter)
        .sort({ _id: 1 })
        .limit(query.limit + 1);
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      const hasNextPage = rows.length > query.limit;
      const nextCursor =
        hasNextPage && last
          ? encodeCursor({ sort: CHANNELS_SORT, value: null, id: last._id })
          : null;
      return { data: page.map(toAlertChannelDto), pageInfo: { nextCursor, hasNextPage } };
    },

    /** A webhook gets a new signing secret, returned in this response and never again. */
    async create(
      actor: Actor,
      input: z.output<typeof createAlertChannelSchema>,
    ): Promise<CreatedAlertChannel> {
      if (input.type === 'WEBHOOK') assertPublicWebhookHost(input.target);
      const ownerId = new Types.ObjectId(actor.userId);
      if ((await AlertChannelModel.countDocuments({ ownerId })) >= MAX_ALERT_CHANNELS) {
        throw new HttpError(
          409,
          'Conflict',
          `You can have at most ${MAX_ALERT_CHANNELS} alert channels; delete one first`,
        );
      }

      const secret = input.type === 'WEBHOOK' ? generateWebhookSecret() : null;
      const channel = await AlertChannelModel.create({
        ownerId,
        type: input.type,
        name: input.name,
        target: input.target,
        secret: secret && encryptSecret(secret, secretKey),
      });
      await audit(actor, 'alertChannel.create', channel);
      return { ...toAlertChannelDto(channel), secret };
    },

    async get(actor: Actor, channelId: string): Promise<AlertChannel> {
      return toAlertChannelDto(await findOwned(actor, channelId));
    },

    async update(
      actor: Actor,
      channelId: string,
      patch: z.output<typeof updateAlertChannelSchema>,
    ): Promise<AlertChannel> {
      const channel = await findOwned(actor, channelId);
      if (patch.name !== undefined) channel.name = patch.name;
      if (patch.active !== undefined) channel.active = patch.active;
      if (patch.target !== undefined) {
        const target = parseTarget(channel.type, patch.target);
        if (target !== channel.target) {
          channel.target = target;
          // The last outcome was for the old destination.
          channel.lastDeliveryStatus = null;
          channel.lastDeliveryAt = null;
          channel.lastDeliveryError = null;
        }
      }
      await channel.save();
      await audit(actor, 'alertChannel.update', channel);
      return toAlertChannelDto(channel);
    },

    /** Deliveries go with the channel; a queued test for it is dropped by the worker. */
    async remove(actor: Actor, channelId: string): Promise<void> {
      const channel = await findOwned(actor, channelId);
      await AlertDeliveryModel.deleteMany({ channelId: channel._id });
      await channel.deleteOne();
      await audit(actor, 'alertChannel.delete', channel);
    },

    /** Queues a sample alert, sent even to an inactive channel; `lastDelivery` shows the result. */
    async test(actor: Actor, channelId: string): Promise<TestAlertResult> {
      const channel = await findOwned(actor, channelId);
      await alerts.enqueueAlert({ kind: 'TEST', channelId: channel.id });
      await audit(actor, 'alertChannel.test', channel);
      return { status: 'QUEUED' };
    },
  };
}

export type AlertChannelsService = ReturnType<typeof createAlertChannelsService>;

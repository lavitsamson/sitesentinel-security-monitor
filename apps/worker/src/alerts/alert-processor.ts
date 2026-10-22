import type { Clock } from '@sitesentinel/checks';
import {
  AlertChannelModel,
  AlertDeliveryModel,
  IncidentModel,
  SiteModel,
  UserModel,
  type AlertChannelDocument,
} from '@sitesentinel/db';
import type { AlertJob, IncidentEvent } from '@sitesentinel/shared';
import type { Types } from 'mongoose';
import type { Logger } from '../logger.js';
import { buildAlertMessage, type AlertMessage } from './alert-message.js';
import type { AlertTarget, SendAlert } from './senders.js';

/** The parts of a BullMQ job the processor needs, so it can be tested without Redis. */
export interface AlertJobContext {
  data: AlertJob;
  /** Attempts already used before this one. */
  attemptsMade: number;
  /** Total attempts allowed. */
  attempts: number;
}

/** Some channels failed; throwing hands the job to BullMQ's backoff, which retries only those. */
export class AlertDeliveryError extends Error {
  constructor(readonly failed: number) {
    super(`${failed} alert ${failed === 1 ? 'delivery' : 'deliveries'} failed; retrying`);
    this.name = 'AlertDeliveryError';
  }
}

export type AlertSkipReason = 'INCIDENT_DELETED' | 'CHANNEL_DELETED';

export type AlertOutcome =
  | { kind: 'SKIPPED'; reason: AlertSkipReason }
  | {
      kind: 'DELIVERED';
      /** Channels reached by this attempt. */
      sent: number;
      failed: number;
      /** Channels reached by an earlier attempt, or email channels muted by the owner. */
      skipped: number;
    };

export interface AlertProcessorDeps {
  send: SendAlert;
  /** Decrypts a webhook's stored signing secret (`decryptSecret` with ALERT_SECRET_KEY). */
  decryptSecret: (encrypted: string) => string;
  clock: Clock;
  logger: Logger;
  /** Base of the links in alerts. */
  webOrigin: string;
}

/** Long enough to explain a failure, short enough for a status line in the UI. */
const MAX_ERROR_LENGTH = 300;

function reason(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.length > MAX_ERROR_LENGTH ? `${message.slice(0, MAX_ERROR_LENGTH - 1)}…` : message;
}

export function createAlertProcessor({
  send,
  decryptSecret,
  clock,
  logger,
  webOrigin,
}: AlertProcessorDeps) {
  const targetOf = (channel: AlertChannelDocument): AlertTarget =>
    channel.type === 'EMAIL'
      ? { type: 'EMAIL', target: channel.target }
      : { type: 'WEBHOOK', target: channel.target, secret: decryptSecret(channel.secret ?? '') };

  /** Sends to one channel and records the outcome on the channel. Returns the error, if any. */
  async function attempt(
    channel: AlertChannelDocument,
    message: AlertMessage,
    deliveryId: Types.ObjectId,
  ): Promise<string | null> {
    let error: string | null = null;
    try {
      await send(targetOf(channel), message, deliveryId.toString());
    } catch (err) {
      error = reason(err);
    }
    await AlertChannelModel.updateOne(
      { _id: channel._id },
      {
        $set: {
          lastDeliveryStatus: error ? 'FAILED' : 'SENT',
          lastDeliveryAt: clock.now(),
          lastDeliveryError: error,
        },
      },
    );
    return error;
  }

  async function incidentAlert(
    incidentId: string,
    event: IncidentEvent,
    isLastAttempt: boolean,
  ): Promise<AlertOutcome> {
    const incident = await IncidentModel.findById(incidentId);
    const site = incident && (await SiteModel.findById(incident.siteId));
    // Deleted with its site since the job was queued: there is nobody to tell about it.
    if (!incident || !site) return { kind: 'SKIPPED', reason: 'INCIDENT_DELETED' };

    const [owner, channels] = await Promise.all([
      UserModel.findById(incident.ownerId),
      AlertChannelModel.find({ ownerId: incident.ownerId, active: true }).sort({ _id: 1 }),
    ]);
    const emailMuted = owner?.notificationPrefs.emailAlerts === false;
    const message = buildAlertMessage(
      {
        event,
        incident: {
          id: incident.id,
          type: incident.type,
          summary: incident.summary,
          openedAt: incident.openedAt,
          resolvedAt: incident.resolvedAt,
        },
        site: { id: site.id, domain: site.domain, displayName: site.displayName },
      },
      webOrigin,
      clock.now(),
    );

    const outcome = { kind: 'DELIVERED' as const, sent: 0, failed: 0, skipped: 0 };
    for (const channel of channels) {
      if (channel.type === 'EMAIL' && emailMuted) {
        outcome.skipped++;
        continue;
      }
      // The record for (channel, incident, event) survives retries: a channel
      // that was reached on an earlier attempt is not alerted again.
      const delivery = await AlertDeliveryModel.findOneAndUpdate(
        { channelId: channel._id, incidentId: incident._id, event },
        { $setOnInsert: { ownerId: incident.ownerId, status: 'PENDING', attempts: 0 } },
        { upsert: true, returnDocument: 'after' },
      );
      if (delivery.status !== 'PENDING') {
        outcome.skipped++;
        continue;
      }

      const error = await attempt(channel, message, delivery._id);
      await AlertDeliveryModel.updateOne(
        { _id: delivery._id },
        {
          $inc: { attempts: 1 },
          $set: error
            ? { lastError: error, status: isLastAttempt ? 'FAILED' : 'PENDING' }
            : { lastError: null, status: 'SENT', sentAt: clock.now() },
        },
      );
      if (error) {
        outcome.failed++;
        logger.warn({ channelId: channel.id, incidentId, event, error }, 'alert delivery failed');
      } else {
        outcome.sent++;
      }
    }

    if (outcome.failed && !isLastAttempt) throw new AlertDeliveryError(outcome.failed);
    return outcome;
  }

  /** A test send goes to the channel even when it is inactive or email alerts are muted. */
  async function testAlert(channelId: string): Promise<AlertOutcome> {
    const channel = await AlertChannelModel.findById(channelId);
    if (!channel) return { kind: 'SKIPPED', reason: 'CHANNEL_DELETED' };

    const message = buildAlertMessage({ event: 'TEST' }, webOrigin, clock.now());
    const delivery = await AlertDeliveryModel.create({
      channelId: channel._id,
      ownerId: channel.ownerId,
      incidentId: null,
      event: 'TEST',
      status: 'PENDING',
    });
    const error = await attempt(channel, message, delivery._id);
    await AlertDeliveryModel.updateOne(
      { _id: delivery._id },
      {
        $set: error
          ? { attempts: 1, status: 'FAILED', lastError: error }
          : { attempts: 1, status: 'SENT', sentAt: clock.now() },
      },
    );
    return { kind: 'DELIVERED', sent: error ? 0 : 1, failed: error ? 1 : 0, skipped: 0 };
  }

  return async function processAlert(job: AlertJobContext): Promise<AlertOutcome> {
    const { data } = job;
    if (data.kind === 'TEST') return testAlert(data.channelId);
    return incidentAlert(data.incidentId, data.event, job.attemptsMade + 1 >= job.attempts);
  };
}

export type AlertProcessor = ReturnType<typeof createAlertProcessor>;

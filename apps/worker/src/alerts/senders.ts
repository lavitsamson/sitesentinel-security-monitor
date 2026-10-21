import type { Clock, HttpClient } from '@sitesentinel/checks';
import { WEBHOOK_SIGNATURE_HEADER } from '@sitesentinel/shared';
import { signWebhook } from '@sitesentinel/shared/node';
import type { Mailer } from '../mail/mailer.js';
import type { AlertMessage } from './alert-message.js';

/** What a delivery needs to know about its channel. `secret` is already decrypted. */
export type AlertTarget =
  { type: 'EMAIL'; target: string } | { type: 'WEBHOOK'; target: string; secret: string };

/** Delivers one message to one channel, or throws with a reason worth showing the user. */
export type SendAlert = (
  to: AlertTarget,
  message: AlertMessage,
  deliveryId: string,
) => Promise<void>;

export class WebhookResponseError extends Error {
  constructor(readonly status: number) {
    super(`Webhook responded with HTTP ${status}`);
    this.name = 'WebhookResponseError';
  }
}

export interface AlertSenderDeps {
  mailer: Mailer;
  /** The SSRF-guarded client: user-supplied webhook URLs are untrusted (ADR 0002). */
  http: HttpClient;
  clock: Clock;
}

export function createAlertSender({ mailer, http, clock }: AlertSenderDeps): SendAlert {
  return async (to, message, deliveryId) => {
    if (to.type === 'EMAIL') {
      await mailer.send({ to: to.target, subject: message.subject, text: message.text });
      return;
    }

    const body = JSON.stringify(message.payload);
    const timestamp = Math.floor(clock.now().getTime() / 1000);
    const res = await http.request({
      url: to.target,
      method: 'POST',
      // A webhook that redirects is treated as a failure, never followed.
      maxRedirects: 0,
      headers: {
        'content-type': 'application/json',
        [WEBHOOK_SIGNATURE_HEADER]: signWebhook(to.secret, body, timestamp),
        'x-sitesentinel-event': message.payload.event,
        'x-sitesentinel-delivery': deliveryId,
      },
      body,
    });
    if (res.status < 200 || res.status >= 300) throw new WebhookResponseError(res.status);
  };
}

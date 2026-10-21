import { verifyWebhookSignature } from '@sitesentinel/shared/node';
import { MemoryMailer } from '../mail/mailer.js';
import { fakeHttp, manualClock } from '../test/helpers.js';
import { buildAlertMessage } from './alert-message.js';
import { WebhookResponseError, createAlertSender } from './senders.js';

const clock = manualClock('2026-10-21T12:00:00.000Z');
const message = buildAlertMessage({ event: 'TEST' }, 'http://localhost:5173', clock.now());
const SECRET = 'whsec_test-secret';

describe('createAlertSender', () => {
  it('emails the subject and plain-text body', async () => {
    const mailer = new MemoryMailer();
    const send = createAlertSender({ mailer, http: fakeHttp().client, clock });

    await send({ type: 'EMAIL', target: 'ops@example.com' }, message, 'd1');

    expect(mailer.sent).toEqual([
      { to: 'ops@example.com', subject: message.subject, text: message.text },
    ]);
  });

  it('POSTs a signed JSON body that the receiver can verify', async () => {
    const http = fakeHttp(() => ({ status: 204 }));
    const send = createAlertSender({ mailer: new MemoryMailer(), http: http.client, clock });

    await send(
      { type: 'WEBHOOK', target: 'https://hooks.example.com/x', secret: SECRET },
      message,
      'd1',
    );

    const [req] = http.requests;
    expect(req).toMatchObject({
      url: 'https://hooks.example.com/x',
      method: 'POST',
      maxRedirects: 0,
      headers: {
        'content-type': 'application/json',
        'x-sitesentinel-event': 'test',
        'x-sitesentinel-delivery': 'd1',
      },
    });
    expect(JSON.parse(req!.body!)).toEqual(message.payload);
    const signature = req!.headers!['X-SiteSentinel-Signature']!;
    const now = Math.floor(clock.now().getTime() / 1000);
    expect(verifyWebhookSignature(SECRET, req!.body!, signature, now)).toBe(true);
    expect(verifyWebhookSignature('whsec_other', req!.body!, signature, now)).toBe(false);
  });

  it.each([301, 404, 500])('fails when the webhook answers %i', async (status) => {
    const http = fakeHttp(() => ({ status }));
    const send = createAlertSender({ mailer: new MemoryMailer(), http: http.client, clock });

    await expect(
      send(
        { type: 'WEBHOOK', target: 'https://hooks.example.com/x', secret: SECRET },
        message,
        'd1',
      ),
    ).rejects.toEqual(new WebhookResponseError(status));
  });
});

import { AlertChannelModel, AlertDeliveryModel, AuditLogModel } from '@sitesentinel/db';
import { MAX_ALERT_CHANNELS } from '@sitesentinel/shared';
import { decryptSecret, signWebhook, verifyWebhookSignature } from '@sitesentinel/shared/node';
import { Types } from 'mongoose';
import { MemoryAlertEnqueuer } from '../infra/alert-queue.js';
import { signUp, useTestMongo } from '../test/int-helpers.js';
import { CSRF, TEST_ALERT_SECRET_KEY, buildTestApp } from '../test-utils.js';

useTestMongo();

type Agent = Awaited<ReturnType<typeof signUp>>['agent'];

const WEBHOOK = { type: 'WEBHOOK', name: 'Ops Slack', target: 'https://hooks.example.com/abc' };
const EMAIL = { type: 'EMAIL', name: 'On-call', target: 'oncall@example.com' };

function setup() {
  const alerts = new MemoryAlertEnqueuer();
  return { app: buildTestApp({ alerts }), alerts };
}

async function createChannel(agent: Agent, body: object = EMAIL) {
  const res = await agent.post('/api/v1/alert-channels').set(CSRF).send(body).expect(201);
  return res.body as { id: string; secret: string | null };
}

describe('POST /alert-channels', () => {
  it('creates an email channel without a secret', async () => {
    const { app } = setup();
    const { agent } = await signUp(app);

    const res = await agent
      .post('/api/v1/alert-channels')
      .set(CSRF)
      .send({ ...EMAIL, target: ' OnCall@Example.com ' });

    expect(res.status).toBe(201);
    expect(res.headers.location).toBe(`/api/v1/alert-channels/${res.body.id}`);
    expect(res.body).toMatchObject({
      type: 'EMAIL',
      target: 'oncall@example.com',
      active: true,
      lastDelivery: null,
      secret: null,
    });
    expect(await AuditLogModel.countDocuments({ action: 'alertChannel.create' })).toBe(1);
  });

  it('returns a webhook signing secret once and stores it encrypted', async () => {
    const { app } = setup();
    const { agent } = await signUp(app);

    const created = await createChannel(agent, WEBHOOK);
    const stored = await AlertChannelModel.findById(created.id);
    const fetched = await agent.get(`/api/v1/alert-channels/${created.id}`).expect(200);

    expect(created.secret).toMatch(/^whsec_/);
    expect(stored!.secret).not.toContain(created.secret);
    expect(decryptSecret(stored!.secret!, TEST_ALERT_SECRET_KEY)).toBe(created.secret);
    expect(fetched.body).not.toHaveProperty('secret');
    // The secret works as documented for receivers.
    const header = signWebhook(created.secret!, '{}', 1_700_000_000);
    expect(verifyWebhookSignature(created.secret!, '{}', header, 1_700_000_000)).toBe(true);
  });

  it.each([
    ['plain http', 'http://hooks.example.com/x'],
    ['a non-default port', 'https://hooks.example.com:8443/x'],
    ['credentials', 'https://user:pass@hooks.example.com/x'],
    ['not a URL', 'hooks.example.com'],
  ])('rejects a webhook with %s', async (_label, target) => {
    const { app } = setup();
    const { agent } = await signUp(app);

    const res = await agent
      .post('/api/v1/alert-channels')
      .set(CSRF)
      .send({ ...WEBHOOK, target });

    expect(res.status).toBe(400);
    expect(res.body.errors[0].path).toBe('target');
  });

  it.each([
    'https://127.0.0.1/hook',
    'https://10.0.0.5/hook',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]/hook',
    'https://[::ffff:192.168.0.1]/hook',
    'https://localhost/hook',
    'https://api.localhost/hook',
    'https://redis/hook',
    'https://printer.local/hook',
    'https://metadata.google.internal/hook',
  ])('refuses internal webhook target %s', async (target) => {
    const { app } = setup();
    const { agent } = await signUp(app);

    const res = await agent
      .post('/api/v1/alert-channels')
      .set(CSRF)
      .send({ ...WEBHOOK, target });

    expect(res.status).toBe(400);
    expect(res.body.detail).toMatch(/public internet host/);
    expect(await AlertChannelModel.countDocuments()).toBe(0);
  });

  it('accepts a webhook on a public IP address', async () => {
    const { app } = setup();
    const { agent } = await signUp(app);

    await createChannel(agent, { ...WEBHOOK, target: 'https://93.184.215.14/hook' });
  });

  it(`allows at most ${MAX_ALERT_CHANNELS} channels per account`, async () => {
    const { app } = setup();
    const { agent } = await signUp(app);
    for (let i = 0; i < MAX_ALERT_CHANNELS; i++) {
      await createChannel(agent, { ...EMAIL, name: `Channel ${i}` });
    }

    const res = await agent.post('/api/v1/alert-channels').set(CSRF).send(EMAIL);

    expect(res.status).toBe(409);
  });
});

describe('GET /alert-channels', () => {
  it('pages through your channels oldest first', async () => {
    const { app } = setup();
    const { agent } = await signUp(app);
    const ids = [];
    for (let i = 0; i < 3; i++)
      ids.push((await createChannel(agent, { ...EMAIL, name: `C${i}` })).id);

    const first = await agent.get('/api/v1/alert-channels?limit=2').expect(200);
    const second = await agent
      .get(`/api/v1/alert-channels?limit=2&cursor=${first.body.pageInfo.nextCursor}`)
      .expect(200);

    expect(first.body.data.map((c: { id: string }) => c.id)).toEqual(ids.slice(0, 2));
    expect(first.body.pageInfo.hasNextPage).toBe(true);
    expect(second.body.data.map((c: { id: string }) => c.id)).toEqual(ids.slice(2));
    expect(second.body.pageInfo).toEqual({ nextCursor: null, hasNextPage: false });
  });

  it('shows the outcome of the last delivery', async () => {
    const { app } = setup();
    const { agent } = await signUp(app);
    const { id } = await createChannel(agent);
    const at = new Date('2026-10-21T09:00:00.000Z');
    await AlertChannelModel.updateOne(
      { _id: id },
      { lastDeliveryStatus: 'FAILED', lastDeliveryAt: at, lastDeliveryError: 'SMTP refused' },
    );

    const res = await agent.get('/api/v1/alert-channels').expect(200);

    expect(res.body.data[0].lastDelivery).toEqual({
      status: 'FAILED',
      at: at.toISOString(),
      error: 'SMTP refused',
    });
  });

  it('requires a session', async () => {
    const { app } = setup();
    const { agent } = await signUp(app);
    await createChannel(agent);

    const res = await agent.post('/api/v1/auth/logout').set(CSRF);
    expect(res.status).toBe(204);
    expect((await agent.get('/api/v1/alert-channels')).status).toBe(401);
  });
});

describe('PATCH /alert-channels/:id', () => {
  it('renames, deactivates and retargets a channel', async () => {
    const { app } = setup();
    const { agent } = await signUp(app);
    const { id } = await createChannel(agent);
    await AlertChannelModel.updateOne(
      { _id: id },
      { lastDeliveryStatus: 'SENT', lastDeliveryAt: new Date() },
    );

    const res = await agent
      .patch(`/api/v1/alert-channels/${id}`)
      .set(CSRF)
      .send({ name: 'Pager', active: false, target: 'Pager@Example.com' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: 'Pager',
      active: false,
      target: 'pager@example.com',
      // The old outcome was for the old address.
      lastDelivery: null,
    });
    expect(await AuditLogModel.countDocuments({ action: 'alertChannel.update' })).toBe(1);
  });

  it("validates the new target against the channel's type", async () => {
    const { app } = setup();
    const { agent } = await signUp(app);
    const email = await createChannel(agent);
    const webhook = await createChannel(agent, WEBHOOK);

    const notEmail = await agent
      .patch(`/api/v1/alert-channels/${email.id}`)
      .set(CSRF)
      .send({ target: 'https://hooks.example.com/x' });
    const internal = await agent
      .patch(`/api/v1/alert-channels/${webhook.id}`)
      .set(CSRF)
      .send({ target: 'https://192.168.1.10/x' });

    expect(notEmail.status).toBe(400);
    expect(notEmail.body.errors[0].path).toBe('target');
    expect(internal.status).toBe(400);
  });

  it('rejects an empty patch and unknown fields such as type', async () => {
    const { app } = setup();
    const { agent } = await signUp(app);
    const { id } = await createChannel(agent);

    const empty = await agent.patch(`/api/v1/alert-channels/${id}`).set(CSRF).send({});
    const type = await agent
      .patch(`/api/v1/alert-channels/${id}`)
      .set(CSRF)
      .send({ type: 'WEBHOOK' });

    expect(empty.status).toBe(400);
    expect(type.status).toBe(400);
  });
});

describe('DELETE /alert-channels/:id', () => {
  it('deletes the channel and its delivery records', async () => {
    const { app } = setup();
    const { agent, user } = await signUp(app);
    const { id } = await createChannel(agent);
    await AlertDeliveryModel.create({
      channelId: id,
      ownerId: user.id,
      incidentId: null,
      event: 'TEST',
      status: 'SENT',
    });

    await agent.delete(`/api/v1/alert-channels/${id}`).set(CSRF).expect(204);

    expect(await AlertChannelModel.countDocuments()).toBe(0);
    expect(await AlertDeliveryModel.countDocuments()).toBe(0);
    expect(await AuditLogModel.countDocuments({ action: 'alertChannel.delete' })).toBe(1);
  });
});

describe('POST /alert-channels/:id/test', () => {
  it('queues a test send for the worker', async () => {
    const { app, alerts } = setup();
    const { agent } = await signUp(app);
    const { id } = await createChannel(agent, WEBHOOK);

    const res = await agent.post(`/api/v1/alert-channels/${id}/test`).set(CSRF);

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ status: 'QUEUED' });
    expect(alerts.jobs).toEqual([{ kind: 'TEST', channelId: id }]);
  });

  it('allows 3 test sends per channel per 5 minutes', async () => {
    const { app, alerts } = setup();
    const { agent } = await signUp(app);
    const first = await createChannel(agent);
    const second = await createChannel(agent);

    for (let i = 0; i < 3; i++) {
      await agent.post(`/api/v1/alert-channels/${first.id}/test`).set(CSRF).expect(202);
    }
    const limited = await agent.post(`/api/v1/alert-channels/${first.id}/test`).set(CSRF);
    const other = await agent.post(`/api/v1/alert-channels/${second.id}/test`).set(CSRF);

    expect(limited.status).toBe(429);
    expect(other.status).toBe(202);
    expect(alerts.jobs).toHaveLength(4);
  });
});

describe('ownership', () => {
  it("returns 404 for another user's channel on every route", async () => {
    const { app, alerts } = setup();
    const { agent: owner } = await signUp(app, 'owner@example.com');
    const { agent: other } = await signUp(app, 'other@example.com');
    const { id } = await createChannel(owner);
    const base = `/api/v1/alert-channels/${id}`;

    const responses = await Promise.all([
      other.get(base),
      other.patch(base).set(CSRF).send({ name: 'Mine now' }),
      other.delete(base).set(CSRF),
      other.post(`${base}/test`).set(CSRF),
    ]);
    const list = await other.get('/api/v1/alert-channels');

    expect(responses.map((r) => r.status)).toEqual([404, 404, 404, 404]);
    expect(list.body.data).toEqual([]);
    expect(alerts.jobs).toEqual([]);
    expect(await AlertChannelModel.findById(id)).toMatchObject({ name: EMAIL.name });
  });

  it('returns 404 for malformed and unknown ids', async () => {
    const { app } = setup();
    const { agent } = await signUp(app);

    expect((await agent.get('/api/v1/alert-channels/nope')).status).toBe(404);
    expect((await agent.get(`/api/v1/alert-channels/${new Types.ObjectId()}`)).status).toBe(404);
  });
});

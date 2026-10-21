import { jest } from '@jest/globals';
import {
  AlertChannelModel,
  AlertDeliveryModel,
  IncidentModel,
  UserModel,
  type SiteDocument,
} from '@sitesentinel/db';
import type { IncidentEvent } from '@sitesentinel/shared';
import {
  createSite,
  createUser,
  manualClock,
  silentLogger,
  useTestMongo,
} from '../test/helpers.js';
import {
  AlertDeliveryError,
  createAlertProcessor,
  type AlertJobContext,
} from './alert-processor.js';
import type { AlertTarget, SendAlert } from './senders.js';

useTestMongo();

function setup() {
  const clock = manualClock();
  /** Targets that fail, by address; everything else succeeds. */
  const failing = new Set<string>();
  const send = jest.fn<SendAlert>(async (to: AlertTarget) => {
    if (failing.has(to.target)) throw new Error(`could not reach ${to.target}`);
  });
  const process = createAlertProcessor({
    send,
    decryptSecret: (encrypted) => {
      if (encrypted === 'corrupt')
        throw new Error('Unsupported state or unable to authenticate data');
      return `decrypted:${encrypted}`;
    },
    clock,
    logger: silentLogger,
    webOrigin: 'http://localhost:5173',
  });
  const incidentJob = (
    incidentId: string,
    event: IncidentEvent = 'OPENED',
    { attemptsMade = 0, attempts = 5 } = {},
  ): AlertJobContext => ({
    data: { kind: 'INCIDENT', incidentId, event },
    attemptsMade,
    attempts,
  });
  const sentTo = () => send.mock.calls.map(([to]) => to.target);
  return { clock, failing, send, process, incidentJob, sentTo };
}

async function siteWithIncident() {
  const owner = await createUser();
  const site = await createSite(owner._id, { domain: 'shop.example.com' });
  const incident = await IncidentModel.create({
    siteId: site._id,
    ownerId: owner._id,
    type: 'TLS',
    summary: 'TLS check failed for shop.example.com',
    openedAt: new Date('2026-10-21T08:00:00Z'),
    openingRunId: site._id,
  });
  return { owner, site, incident };
}

function channel(
  site: Pick<SiteDocument, 'ownerId'>,
  type: 'EMAIL' | 'WEBHOOK',
  target: string,
  extra: { active?: boolean; secret?: string } = {},
) {
  return AlertChannelModel.create({
    ownerId: site.ownerId,
    type,
    name: target,
    target,
    secret: type === 'WEBHOOK' ? (extra.secret ?? 'enc') : null,
    active: extra.active ?? true,
  });
}

describe('alert processor: incident alerts', () => {
  it("sends to each of the owner's active channels and records the deliveries", async () => {
    const { process, incidentJob, send, sentTo } = setup();
    const { site, incident } = await siteWithIncident();
    const email = await channel(site, 'EMAIL', 'ops@example.com');
    await channel(site, 'WEBHOOK', 'https://hooks.example.com/a', { secret: 'abc' });
    await channel(site, 'EMAIL', 'paused@example.com', { active: false });
    const stranger = await createUser();
    await channel({ ownerId: stranger._id }, 'EMAIL', 'stranger@example.com');

    const outcome = await process(incidentJob(incident.id));

    expect(outcome).toEqual({ kind: 'DELIVERED', sent: 2, failed: 0, skipped: 0 });
    expect(sentTo()).toEqual(['ops@example.com', 'https://hooks.example.com/a']);
    expect(send.mock.calls[1]![0]).toMatchObject({ secret: 'decrypted:abc' });
    expect(send.mock.calls[0]![1]).toMatchObject({ event: 'OPENED' });
    const deliveries = await AlertDeliveryModel.find({ incidentId: incident._id });
    expect(deliveries.map((d) => [d.status, d.attempts, d.event])).toEqual([
      ['SENT', 1, 'OPENED'],
      ['SENT', 1, 'OPENED'],
    ]);
    expect(await AlertChannelModel.findById(email._id)).toMatchObject({
      lastDeliveryStatus: 'SENT',
      lastDeliveryError: null,
    });
  });

  it('skips email channels when the owner muted email alerts, but not webhooks', async () => {
    const { process, incidentJob, sentTo } = setup();
    const { owner, site, incident } = await siteWithIncident();
    await UserModel.updateOne({ _id: owner._id }, { 'notificationPrefs.emailAlerts': false });
    await channel(site, 'EMAIL', 'ops@example.com');
    await channel(site, 'WEBHOOK', 'https://hooks.example.com/a');

    const outcome = await process(incidentJob(incident.id));

    expect(outcome).toMatchObject({ sent: 1, skipped: 1 });
    expect(sentTo()).toEqual(['https://hooks.example.com/a']);
  });

  it('retries only the channels that failed, so nobody is alerted twice', async () => {
    const { process, incidentJob, failing, sentTo } = setup();
    const { site, incident } = await siteWithIncident();
    await channel(site, 'EMAIL', 'ops@example.com');
    const hook = await channel(site, 'WEBHOOK', 'https://hooks.example.com/a');
    failing.add('https://hooks.example.com/a');

    await expect(process(incidentJob(incident.id))).rejects.toEqual(new AlertDeliveryError(1));
    expect(await AlertChannelModel.findById(hook._id)).toMatchObject({
      lastDeliveryStatus: 'FAILED',
      lastDeliveryError: 'could not reach https://hooks.example.com/a',
    });

    failing.clear();
    const outcome = await process(incidentJob(incident.id, 'OPENED', { attemptsMade: 1 }));

    expect(outcome).toEqual({ kind: 'DELIVERED', sent: 1, failed: 0, skipped: 1 });
    expect(sentTo()).toEqual([
      'ops@example.com',
      'https://hooks.example.com/a',
      'https://hooks.example.com/a',
    ]);
    const webhookDelivery = await AlertDeliveryModel.findOne({ channelId: hook._id });
    expect(webhookDelivery).toMatchObject({ status: 'SENT', attempts: 2, lastError: null });
  });

  it('marks a delivery FAILED on the last attempt instead of retrying', async () => {
    const { process, incidentJob, failing } = setup();
    const { site, incident } = await siteWithIncident();
    await channel(site, 'WEBHOOK', 'https://hooks.example.com/a');
    failing.add('https://hooks.example.com/a');

    const outcome = await process(incidentJob(incident.id, 'OPENED', { attemptsMade: 4 }));

    expect(outcome).toMatchObject({ sent: 0, failed: 1 });
    expect(await AlertDeliveryModel.findOne()).toMatchObject({ status: 'FAILED', attempts: 1 });
  });

  it('treats an undecryptable webhook secret as a failed delivery', async () => {
    const { process, incidentJob, send } = setup();
    const { site, incident } = await siteWithIncident();
    const hook = await channel(site, 'WEBHOOK', 'https://hooks.example.com/a', {
      secret: 'corrupt',
    });

    await expect(process(incidentJob(incident.id))).rejects.toBeInstanceOf(AlertDeliveryError);
    expect(send).not.toHaveBeenCalled();
    expect((await AlertChannelModel.findById(hook._id))!.lastDeliveryError).toMatch(/authenticate/);
  });

  it('alerts OPENED and RESOLVED separately', async () => {
    const { process, incidentJob, send } = setup();
    const { site, incident } = await siteWithIncident();
    await channel(site, 'EMAIL', 'ops@example.com');
    await process(incidentJob(incident.id, 'OPENED'));
    incident.resolvedAt = new Date('2026-10-21T09:30:00Z');
    await incident.save();

    await process(incidentJob(incident.id, 'RESOLVED'));

    expect(send.mock.calls.map(([, message]) => message.event)).toEqual(['OPENED', 'RESOLVED']);
    expect(send.mock.calls[1]![1].text).toContain('after 1h 30m');
  });

  it('skips an incident deleted with its site', async () => {
    const { process, incidentJob, send } = setup();
    const { site, incident } = await siteWithIncident();
    await channel(site, 'EMAIL', 'ops@example.com');
    await site.deleteOne();

    expect(await process(incidentJob(incident.id))).toEqual({
      kind: 'SKIPPED',
      reason: 'INCIDENT_DELETED',
    });
    expect(send).not.toHaveBeenCalled();
  });
});

describe('alert processor: test sends', () => {
  const testJob = (channelId: string): AlertJobContext => ({
    data: { kind: 'TEST', channelId },
    attemptsMade: 0,
    attempts: 1,
  });

  it('sends a test even to an inactive channel and records it', async () => {
    const { process, send } = setup();
    const owner = await createUser();
    const ch = await channel({ ownerId: owner._id }, 'EMAIL', 'ops@example.com', {
      active: false,
    });

    expect(await process(testJob(ch.id))).toEqual({
      kind: 'DELIVERED',
      sent: 1,
      failed: 0,
      skipped: 0,
    });
    expect(send.mock.calls[0]![1]).toMatchObject({ event: 'TEST' });
    expect(await AlertDeliveryModel.findOne({ channelId: ch._id })).toMatchObject({
      event: 'TEST',
      incidentId: null,
      status: 'SENT',
    });
  });

  it('reports a failed test on the channel without throwing', async () => {
    const { process, failing } = setup();
    const owner = await createUser();
    const ch = await channel({ ownerId: owner._id }, 'WEBHOOK', 'https://hooks.example.com/a');
    failing.add('https://hooks.example.com/a');

    expect(await process(testJob(ch.id))).toMatchObject({ sent: 0, failed: 1 });
    expect(await AlertChannelModel.findById(ch._id)).toMatchObject({
      lastDeliveryStatus: 'FAILED',
      lastDeliveryError: 'could not reach https://hooks.example.com/a',
    });
  });

  it('allows any number of test deliveries per channel', async () => {
    const { process } = setup();
    const owner = await createUser();
    const ch = await channel({ ownerId: owner._id }, 'EMAIL', 'ops@example.com');

    await process(testJob(ch.id));
    await process(testJob(ch.id));

    expect(await AlertDeliveryModel.countDocuments({ channelId: ch._id })).toBe(2);
  });

  it('skips a channel deleted since the test was queued', async () => {
    const { process } = setup();

    expect(await process(testJob('6712f0c2a1b2c3d4e5f60718'))).toEqual({
      kind: 'SKIPPED',
      reason: 'CHANNEL_DELETED',
    });
  });
});

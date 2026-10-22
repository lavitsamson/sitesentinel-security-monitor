import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { alertChannelsApi } from '../api/alert-channels';
import { makeAlertChannel, page } from '../test/fixtures';
import { TEST_POLL_ATTEMPTS, TEST_POLL_INTERVAL_MS, useAlertChannelsStore } from './alert-channels';

vi.mock('../api/alert-channels', () => ({
  alertChannelsApi: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    test: vi.fn(),
  },
}));
const api = vi.mocked(alertChannelsApi);

const email = makeAlertChannel({ id: 'a' });
const webhook = makeAlertChannel({
  id: 'b',
  type: 'WEBHOOK',
  name: 'Slack',
  target: 'https://hooks.example.com/x',
});

describe('alert channels store', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads channels and reports errors', async () => {
    api.list.mockResolvedValueOnce(page([email])).mockRejectedValueOnce(new TypeError('offline'));
    const channels = useAlertChannelsStore();

    await channels.load();
    expect(channels.items).toEqual([email]);

    await channels.load();
    expect(channels.error).toMatch(/Can't reach the server/);
    expect(channels.loading).toBe(false);
  });

  it('adds a created channel without keeping its secret', async () => {
    api.create.mockResolvedValue({ ...webhook, secret: 'whsec_x' });
    const channels = useAlertChannelsStore();

    const created = await channels.create({
      type: 'WEBHOOK',
      name: webhook.name,
      target: webhook.target,
    });

    expect(created.secret).toBe('whsec_x');
    expect(channels.items).toEqual([webhook]);
  });

  it('replaces an updated channel and drops a removed one', async () => {
    api.list.mockResolvedValue(page([email, webhook]));
    api.update.mockResolvedValue({ ...email, active: false });
    const channels = useAlertChannelsStore();
    await channels.load();

    await channels.update('a', { active: false });
    await channels.remove('b');

    expect(channels.items).toEqual([{ ...email, active: false }]);
    expect(api.remove).toHaveBeenCalledWith('b');
  });

  it("polls a test send until the channel's last delivery changes", async () => {
    vi.useFakeTimers();
    const delivered = {
      ...email,
      lastDelivery: { status: 'SENT' as const, at: '2026-10-21T10:00:00.000Z', error: null },
    };
    api.list.mockResolvedValue(page([email]));
    api.test.mockResolvedValue({ status: 'QUEUED' });
    api.get.mockResolvedValueOnce(email).mockResolvedValueOnce(delivered);
    const channels = useAlertChannelsStore();
    await channels.load();

    const outcome = channels.sendTest('a');
    expect(channels.testing.has('a')).toBe(true);
    await vi.advanceTimersByTimeAsync(TEST_POLL_INTERVAL_MS * 2);

    expect(await outcome).toBe('SENT');
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(channels.items).toEqual([delivered]);
    expect(channels.testing.has('a')).toBe(false);
  });

  it('reports a failed test send', async () => {
    vi.useFakeTimers();
    const previous = { status: 'SENT' as const, at: '2026-10-20T10:00:00.000Z', error: null };
    api.list.mockResolvedValue(page([{ ...email, lastDelivery: previous }]));
    api.test.mockResolvedValue({ status: 'QUEUED' });
    api.get.mockResolvedValue({
      ...email,
      lastDelivery: { status: 'FAILED', at: '2026-10-21T10:00:00.000Z', error: 'refused' },
    });
    const channels = useAlertChannelsStore();
    await channels.load();

    const outcome = channels.sendTest('a');
    await vi.advanceTimersByTimeAsync(TEST_POLL_INTERVAL_MS);

    expect(await outcome).toBe('FAILED');
  });

  it('gives up when no outcome arrives', async () => {
    vi.useFakeTimers();
    api.list.mockResolvedValue(page([email]));
    api.test.mockResolvedValue({ status: 'QUEUED' });
    api.get.mockResolvedValue(email);
    const channels = useAlertChannelsStore();
    await channels.load();

    const outcome = channels.sendTest('a');
    await vi.advanceTimersByTimeAsync(TEST_POLL_INTERVAL_MS * TEST_POLL_ATTEMPTS);

    expect(await outcome).toBe('TIMEOUT');
    expect(api.get).toHaveBeenCalledTimes(TEST_POLL_ATTEMPTS);
    expect(channels.testing.size).toBe(0);
  });
});

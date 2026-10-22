import type {
  AlertChannel,
  CreateAlertChannelInput,
  CreatedAlertChannel,
  UpdateAlertChannelInput,
} from '@sitesentinel/shared';
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { alertChannelsApi } from '../api/alert-channels';
import { userMessage } from '../api/errors';

/** How often, and how many times, a test send is polled for its outcome (~30 s in all). */
export const TEST_POLL_INTERVAL_MS = 2_000;
export const TEST_POLL_ATTEMPTS = 15;

export type TestOutcome = 'SENT' | 'FAILED' | 'TIMEOUT';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const useAlertChannelsStore = defineStore('alertChannels', () => {
  const items = ref<AlertChannel[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  /** Ids of channels with a test send waiting for its outcome. */
  const testing = ref<Set<string>>(new Set());

  function replace(channel: AlertChannel) {
    items.value = items.value.map((c) => (c.id === channel.id ? channel : c));
  }

  async function load() {
    loading.value = true;
    error.value = null;
    try {
      items.value = (await alertChannelsApi.list()).data;
    } catch (err) {
      error.value = userMessage(err);
    } finally {
      loading.value = false;
    }
  }

  /** The returned webhook secret is shown once by the caller; it is not kept here. */
  async function create(input: CreateAlertChannelInput): Promise<CreatedAlertChannel> {
    const created = await alertChannelsApi.create(input);
    const { secret: _secret, ...channel } = created;
    items.value = [...items.value, channel];
    return created;
  }

  async function update(id: string, patch: UpdateAlertChannelInput) {
    const channel = await alertChannelsApi.update(id, patch);
    replace(channel);
    return channel;
  }

  async function remove(id: string) {
    await alertChannelsApi.remove(id);
    items.value = items.value.filter((c) => c.id !== id);
  }

  /**
   * Queues a test send, then polls the channel until its `lastDelivery` changes:
   * the worker records the outcome there. Gives up (TIMEOUT) after ~30 seconds,
   * e.g. when no worker is running.
   */
  async function sendTest(id: string): Promise<TestOutcome> {
    const before = items.value.find((c) => c.id === id)?.lastDelivery?.at ?? null;
    testing.value = new Set(testing.value).add(id);
    try {
      await alertChannelsApi.test(id);
      for (let attempt = 0; attempt < TEST_POLL_ATTEMPTS; attempt++) {
        await sleep(TEST_POLL_INTERVAL_MS);
        const channel = await alertChannelsApi.get(id);
        if (channel.lastDelivery && channel.lastDelivery.at !== before) {
          replace(channel);
          return channel.lastDelivery.status;
        }
      }
      return 'TIMEOUT';
    } finally {
      const next = new Set(testing.value);
      next.delete(id);
      testing.value = next;
    }
  }

  return { items, loading, error, testing, load, create, update, remove, sendTest };
});

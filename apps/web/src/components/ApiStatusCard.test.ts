import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchReadiness } from '../api/client';
import { mountWithVuetify } from '../test/mount';
import ApiStatusCard from './ApiStatusCard.vue';

vi.mock('../api/client', () => ({ fetchReadiness: vi.fn() }));
const fetchReadinessMock = vi.mocked(fetchReadiness);

describe('ApiStatusCard', () => {
  beforeEach(() => {
    fetchReadinessMock.mockReset();
  });

  it('shows a loading state while the request is in flight', () => {
    fetchReadinessMock.mockReturnValue(new Promise(() => undefined));

    const wrapper = mountWithVuetify(ApiStatusCard);

    expect(wrapper.find('[data-test="loading"]').exists()).toBe(true);
  });

  it('lists each dependency when all are up', async () => {
    fetchReadinessMock.mockResolvedValue({
      status: 'ok',
      checks: { mongo: { status: 'up', latencyMs: 4 }, redis: { status: 'up', latencyMs: 1 } },
    });

    const wrapper = mountWithVuetify(ApiStatusCard);
    await flushPromises();

    expect(wrapper.get('[data-test="summary"]').text()).toContain('All systems operational');
    expect(wrapper.text()).toContain('mongo');
    expect(wrapper.text()).toContain('4 ms');
  });

  it('explains which dependency is down', async () => {
    fetchReadinessMock.mockResolvedValue({
      status: 'error',
      checks: { redis: { status: 'down', latencyMs: 2000, error: 'timed out after 2000 ms' } },
    });

    const wrapper = mountWithVuetify(ApiStatusCard);
    await flushPromises();

    expect(wrapper.get('[data-test="summary"]').text()).toContain('Degraded');
    expect(wrapper.text()).toContain('timed out after 2000 ms');
  });

  it('shows an error state when the API is unreachable', async () => {
    fetchReadinessMock.mockRejectedValue(new Error('Failed to fetch'));

    const wrapper = mountWithVuetify(ApiStatusCard);
    await flushPromises();

    expect(wrapper.get('[data-test="error"]').text()).toContain('Failed to fetch');
  });
});

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { incidentsApi } from '../api/incidents';
import { makeIncident, page } from '../test/fixtures';
import { useIncidentsStore } from './incidents';

vi.mock('../api/incidents', () => ({ incidentsApi: { list: vi.fn() } }));
const list = vi.mocked(incidentsApi.list);

const first = makeIncident({ id: '1' });
const second = makeIncident({ id: '2' });

describe('incidents store', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setActivePinia(createPinia());
  });

  it('loads open incidents by default and appends the next page', async () => {
    list.mockResolvedValueOnce(page([first], 'next')).mockResolvedValueOnce(page([second]));
    const incidents = useIncidentsStore();

    await incidents.load();
    await incidents.loadMore();

    expect(list.mock.calls[0]?.[0]).toEqual({ open: true, siteId: undefined, limit: 20 });
    expect(list.mock.calls[1]?.[0]).toMatchObject({ cursor: 'next' });
    expect(incidents.items).toEqual([first, second]);
    expect(incidents.hasMore).toBe(false);
  });

  it('maps the filter to the open parameter', async () => {
    list.mockResolvedValue(page([]));
    const incidents = useIncidentsStore();

    await incidents.load({ filter: 'resolved' });
    await incidents.load({ filter: 'all' });

    expect(list.mock.calls[0]?.[0]?.open).toBe(false);
    expect(list.mock.calls[1]?.[0]?.open).toBeUndefined();
  });

  it('discards a page that arrives after the filter changed', async () => {
    let finishOld: (value: ReturnType<typeof page<typeof first>>) => void = () => undefined;
    list
      .mockImplementationOnce(() => new Promise((resolve) => (finishOld = resolve)))
      .mockResolvedValueOnce(page([second]));
    const incidents = useIncidentsStore();

    const old = incidents.load({ filter: 'open' });
    await incidents.load({ filter: 'all' });
    finishOld(page([first]));
    await old;

    expect(incidents.items).toEqual([second]);
    expect(incidents.loading).toBe(false);
  });

  it('does nothing on loadMore without a next page', async () => {
    list.mockResolvedValue(page([first]));
    const incidents = useIncidentsStore();
    await incidents.load();

    await incidents.loadMore();

    expect(list).toHaveBeenCalledOnce();
  });
});

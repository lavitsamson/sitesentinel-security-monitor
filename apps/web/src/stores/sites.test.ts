import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { sitesApi } from '../api/sites';
import { makeSite, page } from '../test/fixtures';
import { useSitesStore } from './sites';

vi.mock('../api/sites', () => ({
  sitesApi: {
    list: vi.fn(),
    summary: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    verify: vi.fn(),
    bulk: vi.fn(),
  },
}));
const api = vi.mocked(sitesApi);

const a = makeSite({ id: 'a', displayName: 'A' });
const b = makeSite({ id: 'b', displayName: 'B' });
const c = makeSite({ id: 'c', displayName: 'C' });

/** The params of the nth list call (0-based). */
const listParams = (n: number) => api.list.mock.calls[n]?.[0];

describe('sites store', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setActivePinia(createPinia());
  });

  it('loads the first page with the current filters and sort', async () => {
    api.list.mockResolvedValue(page([a, b], 'cursor-2'));
    const sites = useSitesStore();

    await sites.load();

    expect(listParams(0)).toEqual({ sort: 'name', limit: 20, cursor: undefined });
    expect(sites).toMatchObject({ items: [a, b], hasNextPage: true, hasPreviousPage: false });
  });

  it('pages forward with the API cursor and back with a remembered one', async () => {
    api.list
      .mockResolvedValueOnce(page([a], 'cursor-2'))
      .mockResolvedValueOnce(page([b], 'cursor-3'))
      .mockResolvedValueOnce(page([a], 'cursor-2'));
    const sites = useSitesStore();

    await sites.load();
    await sites.nextPage();
    expect(sites.items).toEqual([b]);
    expect(sites.pageIndex).toBe(1);

    await sites.previousPage();

    expect(listParams(1)?.cursor).toBe('cursor-2');
    expect(listParams(2)?.cursor).toBeUndefined();
    expect(sites).toMatchObject({ items: [a], pageIndex: 0, hasPreviousPage: false });
  });

  it('does not page past the ends', async () => {
    api.list.mockResolvedValue(page([a]));
    const sites = useSitesStore();
    await sites.load();

    await sites.nextPage();
    await sites.previousPage();

    expect(api.list).toHaveBeenCalledOnce();
  });

  it('returns to page one when filters, sort or page size change', async () => {
    api.list.mockResolvedValueOnce(page([a], 'cursor-2')).mockResolvedValue(page([c]));
    const sites = useSitesStore();
    await sites.load();
    await sites.nextPage();

    await sites.setFilters({ grade: 'C', tag: 'shop' });
    await sites.setSort('-score');
    await sites.setPageSize(50);

    expect(listParams(2)).toEqual({
      grade: 'C',
      tag: 'shop',
      sort: 'name',
      limit: 20,
      cursor: undefined,
    });
    expect(listParams(3)).toMatchObject({ sort: '-score', cursor: undefined });
    expect(listParams(4)).toMatchObject({ limit: 50, cursor: undefined });
    expect(sites.pageIndex).toBe(0);
  });

  it('ignores a slow response that a newer load superseded', async () => {
    let finishSlow: (value: ReturnType<typeof page<typeof a>>) => void = () => undefined;
    api.list
      .mockImplementationOnce(
        (_params, signal) =>
          new Promise((resolve, reject) => {
            finishSlow = resolve;
            signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            );
          }),
      )
      .mockResolvedValueOnce(page([b]));
    const sites = useSitesStore();

    const slow = sites.load();
    await sites.setFilters({ status: 'DOWN' });
    finishSlow(page([a]));
    await slow;

    expect(sites.items).toEqual([b]);
    expect(sites.error).toBeNull();
    expect(sites.loading).toBe(false);
  });

  it('shows a readable error when loading fails', async () => {
    api.list.mockRejectedValue(new ApiError(500));
    const sites = useSitesStore();

    await sites.load();

    expect(sites.error).toBe('Something went wrong on our side. Please try again.');
    expect(sites.loading).toBe(false);
  });

  it('updates a site in place in the current page', async () => {
    api.list.mockResolvedValue(page([a, b]));
    const renamed = { ...b, displayName: 'Renamed' };
    api.update.mockResolvedValue(renamed);
    const sites = useSitesStore();
    await sites.load();

    await sites.update('b', { displayName: 'Renamed' });

    expect(sites.items).toEqual([a, renamed]);
  });

  it('removes a deleted site from the page', async () => {
    api.list.mockResolvedValue(page([a, b]));
    api.remove.mockResolvedValue(undefined);
    const sites = useSitesStore();
    await sites.load();

    await sites.remove('a');

    expect(sites.items).toEqual([b]);
  });

  it('reloads the page after a bulk action, and starts over after a bulk delete', async () => {
    api.list.mockResolvedValueOnce(page([a], 'cursor-2')).mockResolvedValue(page([b]));
    api.bulk.mockResolvedValue({ action: 'PAUSE', succeeded: ['b'], skipped: [] });
    const sites = useSitesStore();
    await sites.load();
    await sites.nextPage();

    await sites.bulk({ action: 'PAUSE', siteIds: ['b'] });
    expect(listParams(2)?.cursor).toBe('cursor-2');

    await sites.bulk({ action: 'DELETE', siteIds: ['b'] });
    expect(listParams(3)?.cursor).toBeUndefined();
    expect(sites.pageIndex).toBe(0);
  });

  it('loads the dashboard summary', async () => {
    const summary = {
      total: 1,
      unverified: 0,
      paused: 0,
      grades: { A: 1, B: 0, C: 0, D: 0, F: 0, ungraded: 0 },
      statuses: { UP: 1, DOWN: 0, DEGRADED: 0, UNKNOWN: 0 },
      needsAttention: [],
    };
    api.summary.mockResolvedValue(summary);
    const sites = useSitesStore();

    await sites.loadSummary();

    expect(sites.summary).toEqual(summary);
    expect(sites.summaryLoading).toBe(false);
  });
});

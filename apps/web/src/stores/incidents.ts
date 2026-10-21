import type { Incident } from '@sitesentinel/shared';
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { userMessage } from '../api/errors';
import { incidentsApi, type IncidentListParams } from '../api/incidents';

export type IncidentFilter = 'open' | 'resolved' | 'all';

const OPEN_PARAM: Record<IncidentFilter, boolean | undefined> = {
  open: true,
  resolved: false,
  all: undefined,
};

/** A "load more" list of incidents, newest first. */
export const useIncidentsStore = defineStore('incidents', () => {
  const items = ref<Incident[]>([]);
  const filter = ref<IncidentFilter>('open');
  const siteId = ref<string | undefined>();
  const nextCursor = ref<string | null>(null);
  const hasMore = ref(false);
  const loading = ref(false);
  const error = ref<string | null>(null);
  /** Bumped on every fresh load, so a slow "load more" for old filters is discarded. */
  let generation = 0;

  async function fetchPage(append: boolean) {
    const gen = append ? generation : ++generation;
    loading.value = true;
    error.value = null;
    const params: IncidentListParams = {
      open: OPEN_PARAM[filter.value],
      siteId: siteId.value,
      limit: 20,
      ...(append && nextCursor.value && { cursor: nextCursor.value }),
    };
    try {
      const page = await incidentsApi.list(params);
      if (gen !== generation) return;
      items.value = append ? [...items.value, ...page.data] : page.data;
      nextCursor.value = page.pageInfo.nextCursor;
      hasMore.value = page.pageInfo.hasNextPage;
    } catch (err) {
      if (gen === generation) error.value = userMessage(err);
    } finally {
      if (gen === generation) loading.value = false;
    }
  }

  function load(options: { filter?: IncidentFilter; siteId?: string } = {}) {
    if (options.filter) filter.value = options.filter;
    if ('siteId' in options) siteId.value = options.siteId;
    return fetchPage(false);
  }

  function loadMore() {
    return hasMore.value ? fetchPage(true) : Promise.resolve();
  }

  return { items, filter, siteId, hasMore, loading, error, load, loadMore };
});

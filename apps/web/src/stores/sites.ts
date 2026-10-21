import type {
  BulkSitesInput,
  BulkSitesResult,
  CreateSiteInput,
  Grade,
  Site,
  SiteSort,
  SiteStatus,
  SiteSummary,
  UpdateSiteInput,
  VerificationMethod,
} from '@sitesentinel/shared';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { userMessage } from '../api/errors';
import { sitesApi } from '../api/sites';

export interface SiteFilters {
  grade?: Grade;
  status?: SiteStatus;
  tag?: string;
}

export const PAGE_SIZES = [10, 20, 50, 100] as const;

export const useSitesStore = defineStore('sites', () => {
  // --- Paged list ---------------------------------------------------------------
  const items = ref<Site[]>([]);
  const filters = ref<SiteFilters>({});
  const sort = ref<SiteSort>('name');
  const pageSize = ref<number>(20);
  /**
   * Cursor that opened each page visited so far; `cursors[0]` is the first page.
   * The API's cursors only go forward, so "previous" re-uses a remembered one.
   */
  const cursors = ref<(string | undefined)[]>([undefined]);
  const pageIndex = ref(0);
  const hasNextPage = ref(false);
  const nextCursor = ref<string | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  let inFlight: AbortController | null = null;

  const hasPreviousPage = computed(() => pageIndex.value > 0);

  async function load() {
    inFlight?.abort();
    const controller = new AbortController();
    inFlight = controller;
    loading.value = true;
    error.value = null;
    try {
      const page = await sitesApi.list(
        {
          ...filters.value,
          sort: sort.value,
          limit: pageSize.value,
          cursor: cursors.value[pageIndex.value],
        },
        controller.signal,
      );
      items.value = page.data;
      hasNextPage.value = page.pageInfo.hasNextPage;
      nextCursor.value = page.pageInfo.nextCursor;
    } catch (err) {
      if (controller.signal.aborted) return; // superseded by a newer load
      error.value = userMessage(err);
    } finally {
      if (inFlight === controller) {
        inFlight = null;
        loading.value = false;
      }
    }
  }

  /** Back to page one, e.g. after the filters, sort or page size change. */
  function firstPage() {
    cursors.value = [undefined];
    pageIndex.value = 0;
    return load();
  }

  function setFilters(next: SiteFilters) {
    filters.value = { ...next };
    return firstPage();
  }

  function setSort(next: SiteSort) {
    sort.value = next;
    return firstPage();
  }

  function setPageSize(next: number) {
    pageSize.value = next;
    return firstPage();
  }

  function nextPage() {
    if (!hasNextPage.value || !nextCursor.value) return Promise.resolve();
    cursors.value = [...cursors.value.slice(0, pageIndex.value + 1), nextCursor.value];
    pageIndex.value += 1;
    return load();
  }

  function previousPage() {
    if (!hasPreviousPage.value) return Promise.resolve();
    pageIndex.value -= 1;
    return load();
  }

  // --- Dashboard summary ----------------------------------------------------------
  const summary = ref<SiteSummary | null>(null);
  const summaryError = ref<string | null>(null);
  const summaryLoading = ref(false);

  async function loadSummary() {
    summaryLoading.value = true;
    summaryError.value = null;
    try {
      summary.value = await sitesApi.summary();
    } catch (err) {
      summaryError.value = userMessage(err);
    } finally {
      summaryLoading.value = false;
    }
  }

  // --- Mutations ------------------------------------------------------------------
  /** Keeps a changed site in the visible page without a reload. */
  function replace(site: Site) {
    items.value = items.value.map((s) => (s.id === site.id ? site : s));
    return site;
  }

  const create = (input: CreateSiteInput) => sitesApi.create(input);

  async function update(id: string, patch: UpdateSiteInput) {
    return replace(await sitesApi.update(id, patch));
  }

  async function verify(id: string, method?: VerificationMethod) {
    return replace(await sitesApi.verify(id, method));
  }

  async function remove(id: string) {
    await sitesApi.remove(id);
    items.value = items.value.filter((s) => s.id !== id);
  }

  const checkNow = (id: string) => sitesApi.checkNow(id);

  /** Runs a bulk action, then reloads the page so it reflects every change. */
  async function bulk(input: BulkSitesInput): Promise<BulkSitesResult> {
    const result = await sitesApi.bulk(input);
    // A delete can empty the current page; start over rather than show a blank one.
    await (input.action === 'DELETE' ? firstPage() : load());
    return result;
  }

  return {
    items,
    filters,
    sort,
    pageSize,
    pageIndex,
    hasNextPage,
    hasPreviousPage,
    loading,
    error,
    load,
    firstPage,
    setFilters,
    setSort,
    setPageSize,
    nextPage,
    previousPage,
    summary,
    summaryError,
    summaryLoading,
    loadSummary,
    create,
    update,
    verify,
    remove,
    checkNow,
    bulk,
  };
});

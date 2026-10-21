<script setup lang="ts">
import {
  CHECK_INTERVAL_LABELS,
  GRADES,
  SITE_STATUSES,
  SITE_STATUS_LABELS,
  tagSchema,
  type BulkSiteAction,
  type Grade,
  type SiteSort,
  type SiteStatus,
} from '@sitesentinel/shared';
import { computed, onMounted, ref, watch } from 'vue';
import { userMessage } from '../../api/errors';
import BulkActionsBar from '../../components/sites/BulkActionsBar.vue';
import GradeBadge from '../../components/sites/GradeBadge.vue';
import SiteStatusChip from '../../components/sites/SiteStatusChip.vue';
import { PAGE_SIZES, useSitesStore } from '../../stores/sites';
import { describeBulkResult } from '../../utils/bulk';
import { relativeTime } from '../../utils/format';

const sites = useSitesStore();

// --- Filters ----------------------------------------------------------------------
const grade = ref<Grade | null>(sites.filters.grade ?? null);
const status = ref<SiteStatus | null>(sites.filters.status ?? null);
const tag = ref(sites.filters.tag ?? '');
const tagError = ref<string | undefined>();

const gradeItems = GRADES.map((g) => ({ title: `Grade ${g}`, value: g }));
const statusItems = SITE_STATUSES.map((s) => ({ title: SITE_STATUS_LABELS[s], value: s }));
const hasFilters = computed(() => Boolean(grade.value || status.value || tag.value));

function applyFilters() {
  const trimmed = tag.value.trim();
  const parsedTag = trimmed ? tagSchema.safeParse(trimmed) : null;
  if (parsedTag && !parsedTag.success) {
    tagError.value = parsedTag.error.issues[0]?.message;
    return;
  }
  tagError.value = undefined;
  const next = {
    ...(grade.value && { grade: grade.value }),
    ...(status.value && { status: status.value }),
    ...(parsedTag?.success && { tag: parsedTag.data }),
  };
  const current = sites.filters;
  if (next.grade === current.grade && next.status === current.status && next.tag === current.tag) {
    return; // e.g. the tag field lost focus without a change
  }
  selected.value = [];
  void sites.setFilters(next);
}

function clearFilters() {
  grade.value = null;
  status.value = null;
  tag.value = '';
  applyFilters();
}

watch([grade, status], applyFilters);

// --- Sorting: table column keys ↔ API sort values ---------------------------------
const SORT_KEYS = {
  displayName: 'name',
  currentScore: 'score',
  lastCheckedAt: 'lastCheckedAt',
} as const;
type SortKey = keyof typeof SORT_KEYS;

const sortBy = computed(() => {
  const descending = sites.sort.startsWith('-');
  const apiKey = descending ? sites.sort.slice(1) : sites.sort;
  const key = (Object.keys(SORT_KEYS) as SortKey[]).find((k) => SORT_KEYS[k] === apiKey);
  return [{ key: key ?? 'displayName', order: descending ? ('desc' as const) : ('asc' as const) }];
});

function onSort(next: { key: string; order?: boolean | 'asc' | 'desc' }[]) {
  const first = next[0];
  if (!first || !(first.key in SORT_KEYS)) return;
  const apiKey = SORT_KEYS[first.key as SortKey];
  selected.value = [];
  void sites.setSort((first.order === 'desc' ? `-${apiKey}` : apiKey) as SiteSort);
}

const headers = [
  { title: 'Grade', key: 'currentGrade', sortable: false, width: 72 },
  { title: 'Site', key: 'displayName', sortable: true },
  { title: 'Status', key: 'status', sortable: false },
  { title: 'Score', key: 'currentScore', sortable: true, align: 'end' as const },
  { title: 'Interval', key: 'checkIntervalMinutes', sortable: false },
  { title: 'Last checked', key: 'lastCheckedAt', sortable: true },
];

// --- Paging and selection ---------------------------------------------------------
const selected = ref<string[]>([]);
const pageSizeItems: number[] = [...PAGE_SIZES];

function changePage(direction: 'next' | 'previous') {
  selected.value = [];
  void (direction === 'next' ? sites.nextPage() : sites.previousPage());
}

function changePageSize(size: number | null) {
  if (size === null) return;
  selected.value = [];
  void sites.setPageSize(size);
}

const rangeLabel = computed(() => {
  if (sites.items.length === 0) return '';
  const start = sites.pageIndex * sites.pageSize + 1;
  return `${start}–${start + sites.items.length - 1}`;
});

// --- Bulk actions -----------------------------------------------------------------
const bulkBusy = ref(false);
const snackbar = ref({ show: false, text: '', color: 'success' });

async function runBulk({ action, tag: bulkTag }: { action: BulkSiteAction; tag?: string }) {
  bulkBusy.value = true;
  try {
    const siteIds = [...selected.value];
    const result = await sites.bulk(
      action === 'ADD_TAG' ? { action, siteIds, tag: bulkTag ?? '' } : { action, siteIds },
    );
    selected.value = [];
    snackbar.value = { show: true, text: describeBulkResult(result), color: 'success' };
  } catch (err) {
    snackbar.value = { show: true, text: userMessage(err), color: 'error' };
  } finally {
    bulkBusy.value = false;
  }
}

onMounted(() => {
  void sites.load();
});
</script>

<template>
  <v-container class="py-8" max-width="1200">
    <div class="d-flex flex-wrap align-center ga-4 mb-6">
      <h1 class="text-h4 flex-grow-1">Sites</h1>
      <v-btn :to="{ name: 'site-new' }" color="primary" prepend-icon="mdi-plus">Add site</v-btn>
    </div>

    <v-card border flat class="mb-4">
      <v-card-text>
        <v-row dense align="center">
          <v-col cols="12" sm="4" md="3">
            <v-select
              v-model="grade"
              :items="gradeItems"
              label="Grade"
              clearable
              density="compact"
              hide-details
              data-test="filter-grade"
            />
          </v-col>
          <v-col cols="12" sm="4" md="3">
            <v-select
              v-model="status"
              :items="statusItems"
              label="Status"
              clearable
              density="compact"
              hide-details
              data-test="filter-status"
            />
          </v-col>
          <v-col cols="12" sm="4" md="3">
            <v-text-field
              v-model="tag"
              label="Tag"
              density="compact"
              prepend-inner-icon="mdi-tag-outline"
              clearable
              :error-messages="tagError"
              :hide-details="!tagError"
              data-test="filter-tag"
              @keydown.enter="applyFilters"
              @blur="applyFilters"
              @click:clear="clearFilters"
            />
          </v-col>
          <v-col cols="12" md="3" class="text-md-end">
            <v-btn v-if="hasFilters" variant="text" @click="clearFilters">Clear filters</v-btn>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <BulkActionsBar
      v-if="selected.length"
      :count="selected.length"
      :busy="bulkBusy"
      @run="runBulk"
      @clear="selected = []"
    />

    <v-alert v-if="sites.error" type="error" variant="tonal" class="mb-4" role="alert">
      {{ sites.error }}
      <template #append>
        <v-btn variant="text" @click="sites.load()">Retry</v-btn>
      </template>
    </v-alert>

    <v-card border flat>
      <v-data-table-server
        v-model="selected"
        :headers="headers"
        :items="sites.items"
        :items-length="sites.items.length"
        :items-per-page="sites.pageSize"
        :loading="sites.loading"
        :sort-by="sortBy"
        item-value="id"
        show-select
        must-sort
        hide-default-footer
        loading-text="Loading sites…"
        aria-label="Sites"
        data-test="sites-table"
        @update:sort-by="onSort"
      >
        <template #[`item.currentGrade`]="{ item }">
          <GradeBadge :grade="item.currentGrade" :score="item.currentScore" size="small" />
        </template>
        <template #[`item.displayName`]="{ item }">
          <div class="py-2">
            <router-link
              :to="{ name: 'site', params: { id: item.id } }"
              class="font-weight-medium site-link"
            >
              {{ item.displayName }}
            </router-link>
            <div class="text-body-2 text-medium-emphasis">{{ item.domain }}</div>
            <div class="d-flex flex-wrap ga-1 mt-1">
              <v-chip v-if="item.demo" size="x-small" color="info" variant="tonal" label>
                Demo data
              </v-chip>
              <v-chip
                v-if="!item.verification.verifiedAt"
                size="x-small"
                color="warning"
                variant="tonal"
                label
              >
                Not verified
              </v-chip>
              <v-chip v-if="item.paused" size="x-small" variant="tonal" label>Paused</v-chip>
              <v-chip v-for="t in item.tags" :key="t" size="x-small" variant="outlined" label>
                {{ t }}
              </v-chip>
            </div>
          </div>
        </template>
        <template #[`item.status`]="{ item }">
          <SiteStatusChip :status="item.status" />
        </template>
        <template #[`item.currentScore`]="{ item }">
          {{ item.currentScore ?? '—' }}
        </template>
        <template #[`item.checkIntervalMinutes`]="{ item }">
          {{ CHECK_INTERVAL_LABELS[item.checkIntervalMinutes] }}
        </template>
        <template #[`item.lastCheckedAt`]="{ item }">
          {{ relativeTime(item.lastCheckedAt) }}
        </template>
        <template #no-data>
          <v-empty-state
            v-if="hasFilters"
            icon="mdi-filter-off-outline"
            title="No sites match these filters"
          >
            <template #actions>
              <v-btn @click="clearFilters">Clear filters</v-btn>
            </template>
          </v-empty-state>
          <v-empty-state
            v-else
            icon="mdi-web-plus"
            title="No sites yet"
            text="Add a domain you own to start monitoring it."
          >
            <template #actions>
              <v-btn :to="{ name: 'site-new' }" color="primary">Add site</v-btn>
            </template>
          </v-empty-state>
        </template>
      </v-data-table-server>

      <v-divider />
      <nav class="d-flex flex-wrap align-center justify-end ga-4 pa-3" aria-label="Pagination">
        <div class="d-flex align-center ga-2">
          <span class="text-body-2 text-medium-emphasis" id="page-size-label">Rows per page</span>
          <v-select
            :model-value="sites.pageSize"
            :items="pageSizeItems"
            density="compact"
            variant="outlined"
            hide-details
            aria-labelledby="page-size-label"
            class="page-size"
            @update:model-value="changePageSize"
          />
        </div>
        <span class="text-body-2" aria-live="polite" data-test="page-range">{{ rangeLabel }}</span>
        <div>
          <v-btn
            icon="mdi-chevron-left"
            variant="text"
            aria-label="Previous page"
            :disabled="!sites.hasPreviousPage || sites.loading"
            data-test="previous-page"
            @click="changePage('previous')"
          />
          <v-btn
            icon="mdi-chevron-right"
            variant="text"
            aria-label="Next page"
            :disabled="!sites.hasNextPage || sites.loading"
            data-test="next-page"
            @click="changePage('next')"
          />
        </div>
      </nav>
    </v-card>

    <v-snackbar v-model="snackbar.show" :color="snackbar.color" timeout="6000" data-test="snackbar">
      {{ snackbar.text }}
    </v-snackbar>
  </v-container>
</template>

<style scoped>
.site-link {
  color: inherit;
}

.page-size {
  width: 96px;
}
</style>

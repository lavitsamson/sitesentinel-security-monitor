<script setup lang="ts">
import {
  CHECK_INTERVAL_LABELS,
  CHECK_TYPES,
  CHECK_TYPE_LABELS,
  type CheckRun,
  type CheckType,
  type ScoreHistoryPoint,
  type Site,
  type UpdateSiteInput,
} from '@sitesentinel/shared';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ApiError } from '../../api/client';
import { userMessage } from '../../api/errors';
import { sitesApi } from '../../api/sites';
import ResponseTimeChart from '../../components/charts/ResponseTimeChart.vue';
import ScoreTrendChart from '../../components/charts/ScoreTrendChart.vue';
import CheckCard from '../../components/sites/CheckCard.vue';
import CheckStatusChip from '../../components/sites/CheckStatusChip.vue';
import GradeBadge from '../../components/sites/GradeBadge.vue';
import SiteSettingsDialog from '../../components/sites/SiteSettingsDialog.vue';
import SiteStatusChip from '../../components/sites/SiteStatusChip.vue';
import { useSitesStore } from '../../stores/sites';
import { saveBlob } from '../../utils/download';
import { dateTime, duration, relativeTime } from '../../utils/format';

const props = defineProps<{ id: string }>();
const sites = useSitesStore();
const router = useRouter();

const site = ref<Site | null>(null);
const latest = ref<CheckRun[]>([]);
const history = ref<ScoreHistoryPoint[]>([]);
const uptimeRuns = ref<CheckRun[]>([]);
const loading = ref(true);
const notFound = ref(false);
const error = ref<string | null>(null);

const snackbar = ref({ show: false, text: '', color: 'success' });
const notify = (text: string, color = 'success') => (snackbar.value = { show: true, text, color });

const latestByType = computed(() => new Map(latest.value.map((run) => [run.type, run])));
const verified = computed(() => Boolean(site.value?.verification.verifiedAt));

/** Everything except the run history table, which pages on its own. */
async function loadOverview() {
  const [s, runs, points, uptime] = await Promise.all([
    sitesApi.get(props.id),
    sitesApi.latestRuns(props.id),
    sitesApi.scoreHistory(props.id, 30),
    sitesApi.runs(props.id, { type: 'UPTIME', limit: 100 }),
  ]);
  site.value = s;
  latest.value = runs;
  history.value = points;
  uptimeRuns.value = uptime.data;
}

async function load() {
  loading.value = true;
  error.value = null;
  notFound.value = false;
  try {
    await Promise.all([loadOverview(), loadRuns(false)]);
    document.title = `${site.value?.displayName ?? 'Site'} · SiteSentinel`;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound.value = true;
    else error.value = userMessage(err);
  } finally {
    loading.value = false;
  }
}

// --- Run history ----------------------------------------------------------------
const runType = ref<CheckType | null>(null);
const runs = ref<CheckRun[]>([]);
const runsCursor = ref<string | null>(null);
const runsLoading = ref(false);
const runTypeItems = CHECK_TYPES.map((t) => ({ title: CHECK_TYPE_LABELS[t], value: t }));
const runHeaders = [
  { title: 'Started', key: 'startedAt', sortable: false },
  { title: 'Check', key: 'type', sortable: false },
  { title: 'Result', key: 'status', sortable: false },
  { title: 'Score', key: 'score', sortable: false, align: 'end' as const },
  { title: 'Findings', key: 'findings', sortable: false, align: 'end' as const },
  { title: 'Duration', key: 'durationMs', sortable: false, align: 'end' as const },
  { title: 'Trigger', key: 'trigger', sortable: false },
];

async function loadRuns(append: boolean) {
  runsLoading.value = true;
  try {
    const page = await sitesApi.runs(props.id, {
      limit: 20,
      ...(runType.value && { type: runType.value }),
      ...(append && runsCursor.value && { cursor: runsCursor.value }),
    });
    runs.value = append ? [...runs.value, ...page.data] : page.data;
    runsCursor.value = page.pageInfo.nextCursor;
  } finally {
    runsLoading.value = false;
  }
}

function reloadRuns(append = false) {
  loadRuns(append).catch((err: unknown) => notify(userMessage(err), 'error'));
}

watch(runType, () => reloadRuns());

const checkNowBlocked = computed(() => {
  if (!site.value) return 'Loading';
  if (site.value.demo) return 'Demo sites are checked once a day';
  if (!verified.value) return 'Verify ownership first';
  if (site.value.paused) return 'Resume monitoring first';
  return null;
});

const checking = ref(false);
let pollTimer: ReturnType<typeof setInterval> | undefined;

function stopPolling() {
  clearInterval(pollTimer);
  pollTimer = undefined;
}

/** Results arrive over the next minute; refresh a few times so they show up here. */
function pollForResults() {
  stopPolling();
  let remaining = 12;
  pollTimer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) stopPolling();
    loadOverview().catch(stopPolling);
  }, 5000);
}

async function checkNow() {
  checking.value = true;
  try {
    await sites.checkNow(props.id);
    notify('Checks queued. Results appear here over the next minute.');
    pollForResults();
    reloadRuns();
  } catch (err) {
    notify(userMessage(err), 'error');
  } finally {
    checking.value = false;
  }
}

const downloading = ref(false);

async function downloadReport() {
  if (!site.value) return;
  downloading.value = true;
  try {
    const { blob, filename } = await sitesApi.report(props.id);
    saveBlob(blob, filename ?? `sitesentinel-${site.value.domain}.pdf`);
  } catch (err) {
    notify(userMessage(err), 'error');
  } finally {
    downloading.value = false;
  }
}

async function update(patch: UpdateSiteInput) {
  site.value = await sites.update(props.id, patch);
}

async function togglePaused() {
  if (!site.value) return;
  const paused = !site.value.paused;
  try {
    await update({ paused });
    notify(paused ? 'Monitoring paused.' : 'Monitoring resumed.');
  } catch (err) {
    notify(userMessage(err), 'error');
  }
}

const settingsOpen = ref(false);
const deleteOpen = ref(false);
const deleting = ref(false);

async function remove() {
  deleting.value = true;
  try {
    await sites.remove(props.id);
    await router.push({ name: 'sites' });
  } catch (err) {
    deleteOpen.value = false;
    notify(userMessage(err), 'error');
  } finally {
    deleting.value = false;
  }
}

watch(
  () => props.id,
  () => {
    stopPolling();
    runType.value = null;
    void load();
  },
  { immediate: true },
);
onBeforeUnmount(stopPolling);
</script>

<template>
  <v-container class="py-8" max-width="1200">
    <v-btn :to="{ name: 'sites' }" variant="text" prepend-icon="mdi-arrow-left" class="mb-4">
      All sites
    </v-btn>

    <v-skeleton-loader
      v-if="loading && !site"
      type="heading, card, card"
      aria-label="Loading site"
    />

    <v-card v-else-if="notFound" border flat data-test="not-found">
      <v-empty-state icon="mdi-web-off" title="Site not found" text="It may have been deleted.">
        <template #actions>
          <v-btn :to="{ name: 'sites' }">Back to sites</v-btn>
        </template>
      </v-empty-state>
    </v-card>

    <v-alert v-else-if="error && !site" type="error" variant="tonal" role="alert">
      {{ error }}
      <template #append>
        <v-btn variant="text" @click="load">Retry</v-btn>
      </template>
    </v-alert>

    <template v-else-if="site">
      <!-- Header -->
      <div class="d-flex flex-wrap align-center ga-4 mb-6">
        <GradeBadge :grade="site.currentGrade" :score="site.currentScore" size="large" />
        <div class="flex-grow-1 min-width-0">
          <h1 class="text-h4 text-break">{{ site.displayName }}</h1>
          <p class="text-body-1 text-medium-emphasis text-break">{{ site.domain }}</p>
          <div class="d-flex flex-wrap align-center ga-2 mt-1">
            <SiteStatusChip :status="site.status" />
            <v-chip v-if="site.demo" size="small" color="info" variant="tonal" label>
              Demo data
            </v-chip>
            <v-chip v-if="site.paused" size="small" variant="tonal" label>Paused</v-chip>
            <v-chip v-for="t in site.tags" :key="t" size="small" variant="outlined" label>
              {{ t }}
            </v-chip>
            <span class="text-body-2 text-medium-emphasis">
              {{ CHECK_INTERVAL_LABELS[site.checkIntervalMinutes] }} · last checked
              {{ relativeTime(site.lastCheckedAt) }}
            </span>
          </div>
        </div>
        <div class="d-flex flex-wrap ga-2">
          <v-tooltip :text="checkNowBlocked ?? 'Run every check now'" location="bottom">
            <template #activator="{ props: tip }">
              <span v-bind="tip">
                <v-btn
                  color="primary"
                  variant="flat"
                  prepend-icon="mdi-play-circle-outline"
                  :disabled="Boolean(checkNowBlocked)"
                  :loading="checking"
                  data-test="check-now"
                  @click="checkNow"
                >
                  Check now
                </v-btn>
              </span>
            </template>
          </v-tooltip>
          <v-btn
            v-if="verified && !site.demo"
            :prepend-icon="site.paused ? 'mdi-play' : 'mdi-pause'"
            data-test="toggle-paused"
            @click="togglePaused"
          >
            {{ site.paused ? 'Resume' : 'Pause' }}
          </v-btn>
          <v-btn
            prepend-icon="mdi-file-download-outline"
            :loading="downloading"
            data-test="download-report"
            @click="downloadReport"
          >
            Report (PDF)
          </v-btn>
          <v-btn prepend-icon="mdi-cog-outline" @click="settingsOpen = true">Settings</v-btn>
          <v-btn
            icon="mdi-delete-outline"
            aria-label="Delete site"
            variant="text"
            @click="deleteOpen = true"
          />
        </div>
      </div>

      <v-alert
        v-if="site.demo"
        type="info"
        variant="tonal"
        class="mb-6"
        title="Demo data"
        data-test="demo-notice"
      >
        This is a well-known public site included in the demo. Its history is generated, and it is
        only ever checked once a day with the same passive checks as any verified site.
      </v-alert>

      <v-alert
        v-else-if="!verified"
        type="warning"
        variant="tonal"
        class="mb-6"
        title="Ownership not verified"
        data-test="verify-notice"
      >
        SiteSentinel won't check {{ site.domain }} until you prove you own it with a DNS record or a
        file on the site.
        <template #append>
          <v-btn
            :to="{ name: 'site-setup', params: { id: site.id } }"
            variant="flat"
            color="warning"
          >
            Finish setup
          </v-btn>
        </template>
      </v-alert>

      <!-- Charts -->
      <v-row class="mb-2">
        <v-col cols="12" md="7">
          <v-card border flat height="100%">
            <v-card-title as="h2" class="text-h6">Score, last 30 days</v-card-title>
            <v-card-text>
              <ScoreTrendChart v-if="history.some((p) => p.score !== null)" :points="history" />
              <p v-else class="text-body-2 text-medium-emphasis">No scores yet.</p>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col cols="12" md="5">
          <v-card border flat height="100%">
            <v-card-title as="h2" class="text-h6">Response time</v-card-title>
            <v-card-subtitle>Last {{ uptimeRuns.length || '' }} uptime checks</v-card-subtitle>
            <v-card-text>
              <ResponseTimeChart v-if="uptimeRuns.length" :runs="uptimeRuns" />
              <p v-else class="text-body-2 text-medium-emphasis">No uptime checks yet.</p>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>

      <!-- Per-check results -->
      <h2 class="text-h6 mb-3">Checks</h2>
      <v-row class="mb-6">
        <v-col v-for="type in CHECK_TYPES" :key="type" cols="12" md="6">
          <CheckCard :type="type" :run="latestByType.get(type)" />
        </v-col>
      </v-row>

      <!-- Run history -->
      <v-card border flat>
        <v-card-title as="h2" class="text-h6 d-flex flex-wrap align-center ga-4">
          <span class="flex-grow-1">Run history</span>
          <v-select
            v-model="runType"
            :items="runTypeItems"
            label="Check"
            clearable
            density="compact"
            hide-details
            class="run-filter"
          />
        </v-card-title>
        <v-data-table
          :headers="runHeaders"
          :items="runs"
          :items-per-page="-1"
          :loading="runsLoading"
          hide-default-footer
          density="comfortable"
          aria-label="Run history"
        >
          <template #[`item.startedAt`]="{ item }">{{ dateTime(item.startedAt) }}</template>
          <template #[`item.type`]="{ item }">{{ CHECK_TYPE_LABELS[item.type] }}</template>
          <template #[`item.status`]="{ item }"><CheckStatusChip :status="item.status" /></template>
          <template #[`item.findings`]="{ item }">{{ item.findings.length }}</template>
          <template #[`item.durationMs`]="{ item }">{{ duration(item.durationMs) }}</template>
          <template #[`item.trigger`]="{ item }">
            <span class="text-capitalize">{{ item.trigger.toLowerCase() }}</span>
          </template>
          <template #no-data>
            <p class="text-body-2 text-medium-emphasis py-4">No runs yet.</p>
          </template>
        </v-data-table>
        <v-card-actions v-if="runsCursor">
          <v-spacer />
          <v-btn :loading="runsLoading" @click="reloadRuns(true)">Load more</v-btn>
          <v-spacer />
        </v-card-actions>
      </v-card>

      <SiteSettingsDialog v-model="settingsOpen" :site="site" :save="update" />

      <v-dialog v-model="deleteOpen" max-width="440">
        <v-card :title="`Delete ${site.displayName}?`">
          <v-card-text>
            Its check history and incidents are deleted too. This cannot be undone.
          </v-card-text>
          <v-card-actions>
            <v-spacer />
            <v-btn @click="deleteOpen = false">Cancel</v-btn>
            <v-btn color="error" variant="flat" :loading="deleting" @click="remove">Delete</v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>
    </template>

    <v-snackbar v-model="snackbar.show" :color="snackbar.color" timeout="6000">
      {{ snackbar.text }}
    </v-snackbar>
  </v-container>
</template>

<style scoped>
.min-width-0 {
  min-width: 0;
}

.run-filter {
  max-width: 240px;
  min-width: 180px;
}
</style>

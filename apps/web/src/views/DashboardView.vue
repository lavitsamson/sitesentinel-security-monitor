<script setup lang="ts">
import { CHECK_TYPE_LABELS, type Incident } from '@sitesentinel/shared';
import { computed, onMounted, ref } from 'vue';
import { userMessage } from '../api/errors';
import { incidentsApi } from '../api/incidents';
import GradeDonut from '../components/charts/GradeDonut.vue';
import GradeBadge from '../components/sites/GradeBadge.vue';
import SiteStatusChip from '../components/sites/SiteStatusChip.vue';
import { useAuthStore } from '../stores/auth';
import { useSitesStore } from '../stores/sites';
import { relativeTime } from '../utils/format';

const auth = useAuthStore();
const sites = useSitesStore();

const openIncidents = ref<Incident[]>([]);
const moreOpen = ref(false);
const recent = ref<Incident[]>([]);
const incidentsLoading = ref(true);
const incidentsError = ref<string | null>(null);

/** Opened and resolved incidents as one timeline, newest first. */
const changes = computed(() =>
  recent.value
    .flatMap((incident) => [
      { key: `${incident.id}-open`, incident, kind: 'opened' as const, at: incident.openedAt },
      ...(incident.resolvedAt
        ? [
            {
              key: `${incident.id}-res`,
              incident,
              kind: 'resolved' as const,
              at: incident.resolvedAt,
            },
          ]
        : []),
    ])
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 8),
);

async function loadIncidents() {
  incidentsLoading.value = true;
  incidentsError.value = null;
  try {
    const [open, latest] = await Promise.all([
      incidentsApi.list({ open: true, limit: 5 }),
      incidentsApi.list({ limit: 8 }),
    ]);
    openIncidents.value = open.data;
    moreOpen.value = open.pageInfo.hasNextPage;
    recent.value = latest.data;
  } catch (err) {
    incidentsError.value = userMessage(err);
  } finally {
    incidentsLoading.value = false;
  }
}

function load() {
  return Promise.all([sites.loadSummary(), loadIncidents()]);
}

onMounted(load);

const summary = computed(() => sites.summary);
const kpis = computed(() => {
  const s = summary.value;
  if (!s) return [];
  return [
    { label: 'Sites', value: s.total, icon: 'mdi-web' },
    { label: 'Up', value: s.statuses.UP, icon: 'mdi-arrow-up-circle-outline' },
    {
      label: 'Open incidents',
      value: `${openIncidents.value.length}${moreOpen.value ? '+' : ''}`,
      icon: 'mdi-alert-circle-outline',
    },
    { label: 'Awaiting verification', value: s.unverified, icon: 'mdi-shield-key-outline' },
  ];
});
</script>

<template>
  <v-container class="py-8" max-width="1200">
    <div class="d-flex flex-wrap align-center ga-4 mb-6">
      <div class="flex-grow-1">
        <h1 class="text-h4">Dashboard</h1>
        <p class="text-body-1 text-medium-emphasis">Welcome back, {{ auth.user?.name }}.</p>
      </div>
      <v-btn :to="{ name: 'site-new' }" color="primary" prepend-icon="mdi-plus">Add site</v-btn>
    </div>

    <v-alert
      v-if="sites.summaryError"
      type="error"
      variant="tonal"
      class="mb-6"
      role="alert"
      data-test="summary-error"
    >
      {{ sites.summaryError }}
      <template #append>
        <v-btn variant="text" @click="load">Retry</v-btn>
      </template>
    </v-alert>

    <v-skeleton-loader
      v-if="!summary && sites.summaryLoading"
      type="card, card"
      aria-label="Loading dashboard"
    />

    <v-card v-else-if="summary && summary.total === 0" border flat data-test="empty">
      <v-empty-state
        icon="mdi-web-plus"
        title="Add your first site"
        text="Add a domain you own, prove ownership with a DNS record or a file, and SiteSentinel starts grading it."
      >
        <template #actions>
          <v-btn :to="{ name: 'site-new' }" color="primary">Add site</v-btn>
        </template>
      </v-empty-state>
    </v-card>

    <template v-else-if="summary">
      <v-row class="mb-2">
        <v-col v-for="kpi in kpis" :key="kpi.label" cols="6" md="3">
          <v-card border flat>
            <v-card-item :prepend-icon="kpi.icon">
              <div class="text-h5 font-weight-bold" data-test="kpi-value">{{ kpi.value }}</div>
              <div class="text-body-2 text-medium-emphasis">{{ kpi.label }}</div>
            </v-card-item>
          </v-card>
        </v-col>
      </v-row>

      <v-row>
        <v-col cols="12" md="5">
          <v-card border flat height="100%">
            <v-card-title as="h2" class="text-h6">Grade distribution</v-card-title>
            <v-card-text>
              <GradeDonut :grades="summary.grades" />
            </v-card-text>
          </v-card>
        </v-col>

        <v-col cols="12" md="7">
          <v-card border flat height="100%">
            <v-card-title as="h2" class="text-h6">Needs attention</v-card-title>
            <v-list v-if="summary.needsAttention.length" lines="two" data-test="attention">
              <v-list-item
                v-for="site in summary.needsAttention"
                :key="site.id"
                :to="{ name: 'site', params: { id: site.id } }"
                :title="site.displayName"
                :subtitle="site.domain"
              >
                <template #prepend>
                  <GradeBadge :grade="site.currentGrade" :score="site.currentScore" class="mr-3" />
                </template>
                <template #append>
                  <SiteStatusChip :status="site.status" />
                </template>
              </v-list-item>
            </v-list>
            <v-card-text v-else class="text-body-2 text-medium-emphasis">
              <v-icon icon="mdi-check-circle-outline" color="success" class="mr-1" />
              Nothing needs attention: every site is up and graded C or better.
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>

      <v-row>
        <v-col cols="12" md="6">
          <v-card border flat height="100%">
            <v-card-title as="h2" class="text-h6 d-flex align-center">
              Open incidents
              <v-spacer />
              <v-btn :to="{ name: 'incidents' }" variant="text" size="small">View all</v-btn>
            </v-card-title>
            <v-alert v-if="incidentsError" type="error" variant="tonal" class="ma-4" role="alert">
              {{ incidentsError }}
            </v-alert>
            <v-skeleton-loader v-else-if="incidentsLoading" type="list-item-two-line@3" />
            <v-list v-else-if="openIncidents.length" lines="two" data-test="open-incidents">
              <v-list-item
                v-for="incident in openIncidents"
                :key="incident.id"
                :to="{ name: 'site', params: { id: incident.siteId } }"
                prepend-icon="mdi-alert-circle-outline"
                :title="incident.site.displayName"
                :subtitle="`${CHECK_TYPE_LABELS[incident.type]}: ${incident.summary} · ${relativeTime(incident.openedAt)}`"
              />
            </v-list>
            <v-card-text v-else class="text-body-2 text-medium-emphasis">
              No open incidents.
            </v-card-text>
          </v-card>
        </v-col>

        <v-col cols="12" md="6">
          <v-card border flat height="100%">
            <v-card-title as="h2" class="text-h6">Recent changes</v-card-title>
            <v-skeleton-loader v-if="incidentsLoading" type="list-item-two-line@3" />
            <v-list v-else-if="changes.length" lines="two" data-test="changes">
              <v-list-item
                v-for="change in changes"
                :key="change.key"
                :to="{ name: 'site', params: { id: change.incident.siteId } }"
                :title="`${change.incident.site.displayName}: ${CHECK_TYPE_LABELS[change.incident.type]} ${change.kind === 'opened' ? 'failed' : 'recovered'}`"
                :subtitle="relativeTime(change.at)"
              >
                <template #prepend>
                  <v-icon
                    :icon="change.kind === 'opened' ? 'mdi-arrow-down-bold' : 'mdi-arrow-up-bold'"
                    :color="change.kind === 'opened' ? 'error' : 'success'"
                    aria-hidden="true"
                  />
                </template>
              </v-list-item>
            </v-list>
            <v-card-text v-else-if="!incidentsError" class="text-body-2 text-medium-emphasis">
              No changes yet. Incidents open and resolve here as check results change.
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>
    </template>
  </v-container>
</template>

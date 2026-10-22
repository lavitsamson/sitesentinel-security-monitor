<script setup lang="ts">
import { CHECK_TYPE_LABELS } from '@sitesentinel/shared';
import { onMounted } from 'vue';
import LinkList from '../components/LinkList.vue';
import { useIncidentsStore, type IncidentFilter } from '../stores/incidents';
import { dateTime, elapsed } from '../utils/format';

const incidents = useIncidentsStore();

const filters: { value: IncidentFilter; title: string }[] = [
  { value: 'open', title: 'Open' },
  { value: 'resolved', title: 'Resolved' },
  { value: 'all', title: 'All' },
];

onMounted(() => {
  void incidents.load({ siteId: undefined });
});
</script>

<template>
  <v-container class="py-8" max-width="960">
    <h1 class="text-h4 mb-2">Incidents</h1>
    <p class="text-body-1 text-medium-emphasis mb-6">
      An incident opens when a check starts failing or a site goes down, and resolves when it passes
      again.
    </p>

    <v-btn-toggle
      :model-value="incidents.filter"
      mandatory
      variant="outlined"
      divided
      density="comfortable"
      class="mb-4"
      aria-label="Show incidents"
      @update:model-value="(f: IncidentFilter) => incidents.load({ filter: f })"
    >
      <v-btn v-for="f in filters" :key="f.value" :value="f.value" :data-test="`filter-${f.value}`">
        {{ f.title }}
      </v-btn>
    </v-btn-toggle>

    <v-alert v-if="incidents.error" type="error" variant="tonal" class="mb-4" role="alert">
      {{ incidents.error }}
      <template #append>
        <v-btn variant="text" @click="incidents.load()">Retry</v-btn>
      </template>
    </v-alert>

    <v-skeleton-loader
      v-if="incidents.loading && incidents.items.length === 0"
      type="list-item-three-line@3"
      aria-label="Loading incidents"
    />

    <v-card v-else-if="incidents.items.length === 0 && !incidents.error" border flat>
      <v-empty-state
        icon="mdi-check-circle-outline"
        :title="incidents.filter === 'open' ? 'No open incidents' : 'No incidents'"
        text="Everything that's checked is passing."
      />
    </v-card>

    <v-card v-else border flat>
      <LinkList divided data-test="incidents">
        <li v-for="incident in incidents.items" :key="incident.id">
          <v-list-item :to="{ name: 'site', params: { id: incident.siteId } }" lines="three">
            <template #prepend>
              <v-icon
                :icon="
                  incident.resolvedAt ? 'mdi-check-circle-outline' : 'mdi-alert-circle-outline'
                "
                :color="incident.resolvedAt ? 'success' : 'error'"
                aria-hidden="true"
              />
            </template>
            <v-list-item-title class="font-weight-medium">
              {{ incident.site.displayName }} · {{ CHECK_TYPE_LABELS[incident.type] }}
            </v-list-item-title>
            <v-list-item-subtitle>{{ incident.summary }}</v-list-item-subtitle>
            <div class="text-body-2 text-medium-emphasis mt-1">
              Opened {{ dateTime(incident.openedAt) }}
              <template v-if="incident.resolvedAt">
                · resolved after {{ elapsed(incident.openedAt, incident.resolvedAt) }}
              </template>
              <template v-else>
                · ongoing for {{ elapsed(incident.openedAt, new Date().toISOString()) }}
              </template>
            </div>
            <template #append>
              <v-chip
                :color="incident.resolvedAt ? 'success' : 'error'"
                size="small"
                variant="tonal"
                label
              >
                {{ incident.resolvedAt ? 'Resolved' : 'Open' }}
              </v-chip>
            </template>
          </v-list-item>
        </li>
      </LinkList>
      <v-card-actions v-if="incidents.hasMore">
        <v-spacer />
        <v-btn :loading="incidents.loading" @click="incidents.loadMore()">Load more</v-btn>
        <v-spacer />
      </v-card-actions>
    </v-card>
  </v-container>
</template>

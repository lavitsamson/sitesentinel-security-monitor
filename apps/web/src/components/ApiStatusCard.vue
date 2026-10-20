<script setup lang="ts">
import type { HealthReady } from '@sitesentinel/shared';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { fetchReadiness } from '../api/client';

type State =
  | { kind: 'loading' }
  | { kind: 'loaded'; report: HealthReady }
  | { kind: 'error'; message: string };

const state = ref<State>({ kind: 'loading' });
let controller: AbortController | undefined;

async function load() {
  controller?.abort();
  controller = new AbortController();
  state.value = { kind: 'loading' };
  try {
    state.value = { kind: 'loaded', report: await fetchReadiness(controller.signal) };
  } catch (err) {
    if (controller.signal.aborted) return;
    state.value = {
      kind: 'error',
      message: err instanceof Error ? err.message : 'Could not reach the API',
    };
  }
}

onMounted(load);
onBeforeUnmount(() => controller?.abort());
</script>

<template>
  <v-card border flat>
    <v-card-title class="d-flex align-center">
      System status
      <v-spacer />
      <v-btn
        variant="text"
        size="small"
        prepend-icon="mdi-refresh"
        :disabled="state.kind === 'loading'"
        @click="load"
      >
        Refresh
      </v-btn>
    </v-card-title>

    <v-card-text aria-live="polite">
      <div v-if="state.kind === 'loading'" data-test="loading">
        <v-progress-linear indeterminate color="primary" aria-label="Checking API status" />
      </div>

      <v-alert v-else-if="state.kind === 'error'" type="error" variant="tonal" data-test="error">
        API unreachable: {{ state.message }}
      </v-alert>

      <template v-else>
        <v-alert
          :type="state.report.status === 'ok' ? 'success' : 'warning'"
          variant="tonal"
          class="mb-3"
          data-test="summary"
        >
          {{
            state.report.status === 'ok'
              ? 'All systems operational'
              : 'Degraded: a dependency is down'
          }}
        </v-alert>
        <v-list density="compact" aria-label="Dependency status">
          <v-list-item
            v-for="(check, name) in state.report.checks"
            :key="name"
            :title="String(name)"
            :subtitle="check.status === 'up' ? `${check.latencyMs} ms` : check.error"
          >
            <template #prepend>
              <v-icon
                :icon="check.status === 'up' ? 'mdi-check-circle' : 'mdi-alert-circle'"
                :color="check.status === 'up' ? 'success' : 'error'"
                :aria-label="check.status"
              />
            </template>
          </v-list-item>
        </v-list>
      </template>
    </v-card-text>
  </v-card>
</template>

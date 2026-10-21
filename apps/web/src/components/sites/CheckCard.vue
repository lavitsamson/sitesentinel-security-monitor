<script setup lang="ts">
import {
  CHECK_TYPE_DESCRIPTIONS,
  CHECK_TYPE_LABELS,
  CHECK_WEIGHTS,
  type CheckRun,
  type CheckType,
} from '@sitesentinel/shared';
import { relativeTime } from '../../utils/format';
import CheckStatusChip from './CheckStatusChip.vue';
import FindingsList from './FindingsList.vue';

defineProps<{ type: CheckType; run?: CheckRun }>();
</script>

<template>
  <v-card border flat height="100%" :data-test="`check-${type}`">
    <v-card-item>
      <template #title>
        <h3 class="text-subtitle-1 font-weight-medium">{{ CHECK_TYPE_LABELS[type] }}</h3>
      </template>
      <template #subtitle>
        {{ CHECK_TYPE_DESCRIPTIONS[type] }}
      </template>
      <template #append>
        <CheckStatusChip v-if="run" :status="run.status" />
      </template>
    </v-card-item>
    <v-card-text>
      <template v-if="run">
        <p class="text-body-2 text-medium-emphasis mb-3">
          <span v-if="run.status !== 'ERROR'">
            Score <strong>{{ run.score }}</strong
            >/100 ·
          </span>
          <span v-else>The check couldn't run; the last result still counts. ·</span>
          weight {{ CHECK_WEIGHTS[type] }}% · checked {{ relativeTime(run.startedAt) }}
        </p>
        <FindingsList :findings="run.findings" />
      </template>
      <p v-else class="text-body-2 text-medium-emphasis">Not checked yet.</p>
    </v-card-text>
  </v-card>
</template>

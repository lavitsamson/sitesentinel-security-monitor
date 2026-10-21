<script setup lang="ts">
import { SEVERITIES, type CheckRun } from '@sitesentinel/shared';
import { computed } from 'vue';
import { SEVERITY_COLORS, SEVERITY_ICONS } from '../../utils/colors';

type Finding = CheckRun['findings'][number];

const props = defineProps<{ findings: Finding[] }>();

/** Most severe first; `SEVERITIES` runs info → high. */
const sorted = computed(() =>
  [...props.findings].sort(
    (a, b) => SEVERITIES.indexOf(b.severity) - SEVERITIES.indexOf(a.severity),
  ),
);
</script>

<template>
  <p v-if="sorted.length === 0" class="text-body-2 text-medium-emphasis" data-test="no-findings">
    No issues found.
  </p>
  <ul v-else class="findings" aria-label="Findings">
    <li
      v-for="(finding, i) in sorted"
      :key="`${finding.code}-${i}`"
      class="mb-3"
      data-test="finding"
    >
      <div class="d-flex align-start ga-2">
        <v-chip
          :color="SEVERITY_COLORS[finding.severity]"
          :prepend-icon="SEVERITY_ICONS[finding.severity]"
          size="x-small"
          variant="tonal"
          label
          class="flex-shrink-0 text-capitalize"
          data-test="severity"
        >
          {{ finding.severity }}
        </v-chip>
        <div>
          <p class="text-body-2 font-weight-medium" data-test="message">{{ finding.message }}</p>
          <p class="text-body-2 text-medium-emphasis" data-test="recommendation">
            <span class="font-weight-medium">How to fix:</span> {{ finding.recommendation }}
          </p>
        </div>
      </div>
    </li>
  </ul>
</template>

<style scoped>
.findings {
  list-style: none;
  padding: 0;
}

.findings p {
  overflow-wrap: anywhere;
}
</style>

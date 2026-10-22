<script setup lang="ts">
import { GRADES, type SiteSummary } from '@sitesentinel/shared';
import type { ChartData, ChartOptions } from 'chart.js';
import { computed } from 'vue';
import { Doughnut } from 'vue-chartjs';
import '../../plugins/chart';
import { GRADE_COLORS, UNGRADED_COLOR } from '../../utils/colors';
import { useChartTheme } from './chart-theme';

const props = defineProps<{ grades: SiteSummary['grades'] }>();
const chartTheme = useChartTheme();

const slices = computed(() => [
  ...GRADES.map((g) => ({ label: `Grade ${g}`, count: props.grades[g], color: GRADE_COLORS[g] })),
  { label: 'Not graded', count: props.grades.ungraded, color: UNGRADED_COLOR },
]);
const total = computed(() => slices.value.reduce((sum, s) => sum + s.count, 0));
const summary = computed(
  () =>
    `Grade distribution: ${slices.value.map((s) => `${s.label.replace('Grade ', '')} ${s.count}`).join(', ')}`,
);

const data = computed<ChartData<'doughnut'>>(() => {
  const { colors, surface } = chartTheme.value;
  return {
    labels: slices.value.map((s) => s.label),
    datasets: [
      {
        data: slices.value.map((s) => s.count),
        backgroundColor: slices.value.map((s) => colors[s.color] ?? '#888888'),
        borderColor: surface,
        borderWidth: 2,
      },
    ],
  };
});

const options = computed<ChartOptions<'doughnut'>>(() => ({
  responsive: true,
  maintainAspectRatio: false,
  cutout: '65%',
  plugins: { legend: { display: false } },
}));
</script>

<template>
  <div class="d-flex flex-column flex-sm-row align-center ga-6">
    <div class="donut">
      <Doughnut :data="data" :options="options" :aria-label="summary" />
      <div class="donut-center" aria-hidden="true">
        <div class="text-h4 font-weight-bold">{{ total }}</div>
        <div class="text-caption text-medium-emphasis">sites</div>
      </div>
    </div>
    <ul class="legend" aria-hidden="true">
      <li v-for="slice in slices" :key="slice.label" class="d-flex align-center ga-2 mb-1">
        <span class="swatch" :class="`bg-${slice.color}`" />
        <span class="text-body-2 flex-grow-1">{{ slice.label }}</span>
        <span class="text-body-2 font-weight-medium">{{ slice.count }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.donut {
  position: relative;
  width: 180px;
  height: 180px;
  flex-shrink: 0;
}

.donut-center {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.legend {
  list-style: none;
  padding: 0;
  min-width: 160px;
}

.swatch {
  width: 12px;
  height: 12px;
  border-radius: 3px;
}
</style>

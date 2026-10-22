<script setup lang="ts">
import type { CheckRun } from '@sitesentinel/shared';
import type { ChartData, ChartOptions } from 'chart.js';
import { computed } from 'vue';
import { Line } from 'vue-chartjs';
import '../../plugins/chart';
import { dateTime, duration } from '../../utils/format';
import { useChartTheme } from './chart-theme';

/** UPTIME runs, newest first, as the runs API returns them. */
const props = defineProps<{ runs: CheckRun[] }>();
const chartTheme = useChartTheme();

/** Oldest first, only runs that measured a response time (not DOWN or ERROR runs). */
const samples = computed(() =>
  props.runs
    .flatMap((run) =>
      typeof run.raw.responseTimeMs === 'number'
        ? [{ at: run.startedAt, ms: run.raw.responseTimeMs }]
        : [],
    )
    .reverse(),
);

const summary = computed(() => {
  const values = samples.value.map((s) => s.ms);
  if (values.length === 0) return 'Response time: no measurements yet';
  const average = values.reduce((sum, v) => sum + v, 0) / values.length;
  return `Response time over the last ${values.length} checks: average ${duration(average)}, slowest ${duration(Math.max(...values))}`;
});

const data = computed<ChartData<'line'>>(() => {
  const { primary, primaryFill } = chartTheme.value;
  return {
    labels: samples.value.map((s) => dateTime(s.at)),
    datasets: [
      {
        label: 'Response time',
        data: samples.value.map((s) => s.ms),
        borderColor: primary,
        backgroundColor: primaryFill,
        fill: true,
        tension: 0.25,
        pointRadius: 1.5,
      },
    ],
  };
});

const options = computed<ChartOptions<'line'>>(() => {
  const { text, grid } = chartTheme.value;
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    scales: {
      y: {
        beginAtZero: true,
        ticks: { color: text, callback: (v) => duration(Number(v)) },
        grid: { color: grid },
      },
      x: { ticks: { display: false }, grid: { display: false } },
    },
    plugins: {
      tooltip: { callbacks: { label: (ctx) => duration(Number(ctx.parsed.y)) } },
    },
  };
});
</script>

<template>
  <!-- vue-chartjs renders the canvas as role="img"; the summary is its accessible name. -->
  <div class="chart">
    <Line :data="data" :options="options" :aria-label="summary" />
  </div>
</template>

<style scoped>
.chart {
  position: relative;
  height: 200px;
}
</style>

<script setup lang="ts">
import type { ScoreHistoryPoint } from '@sitesentinel/shared';
import type { ChartData, ChartOptions } from 'chart.js';
import { computed } from 'vue';
import { Line } from 'vue-chartjs';
import '../../plugins/chart';
import { shortDate } from '../../utils/format';
import { useChartTheme } from './chart-theme';

const props = defineProps<{ points: ScoreHistoryPoint[] }>();
const chartTheme = useChartTheme();

const scored = computed(() => props.points.filter((p) => p.score !== null));
const summary = computed(() => {
  const first = scored.value[0];
  const last = scored.value.at(-1);
  if (!first || !last) return 'Score trend: no scores yet';
  return `Score trend over ${props.points.length} days: from ${first.score} (grade ${first.grade}) on ${shortDate(first.date)} to ${last.score} (grade ${last.grade}) on ${shortDate(last.date)}`;
});

const data = computed<ChartData<'line'>>(() => {
  const { primary, primaryFill } = chartTheme.value;
  return {
    labels: props.points.map((p) => shortDate(p.date)),
    datasets: [
      {
        label: 'Score',
        data: props.points.map((p) => p.score),
        borderColor: primary,
        backgroundColor: primaryFill,
        fill: true,
        tension: 0.25,
        pointRadius: 2,
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
      y: { min: 0, max: 100, ticks: { color: text, stepSize: 20 }, grid: { color: grid } },
      x: { ticks: { color: text, maxTicksLimit: 8, autoSkip: true }, grid: { display: false } },
    },
    plugins: {
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const point = props.points[ctx.dataIndex];
            return point?.score === null || !point
              ? 'No score'
              : `Score ${point.score} · grade ${point.grade}`;
          },
        },
      },
    },
  };
});
</script>

<template>
  <div class="chart" role="img" :aria-label="summary">
    <Line :data="data" :options="options" />
  </div>
</template>

<style scoped>
.chart {
  position: relative;
  height: 240px;
}
</style>

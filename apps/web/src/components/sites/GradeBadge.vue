<script setup lang="ts">
import type { Grade } from '@sitesentinel/shared';
import { computed } from 'vue';
import { GRADE_COLORS, UNGRADED_COLOR } from '../../utils/colors';

const props = withDefaults(
  defineProps<{
    grade: Grade | null;
    score?: number | null;
    size?: 'small' | 'default' | 'large';
  }>(),
  { score: null, size: 'default' },
);

const pixels = { small: 32, default: 40, large: 72 } as const;
const label = computed(() =>
  props.grade
    ? `Grade ${props.grade}${props.score === null ? '' : `, score ${props.score} out of 100`}`
    : 'Not graded yet',
);
</script>

<template>
  <v-avatar
    :color="grade ? GRADE_COLORS[grade] : UNGRADED_COLOR"
    :size="pixels[size]"
    :variant="grade ? 'flat' : 'tonal'"
    rounded="lg"
    role="img"
    :aria-label="label"
    :title="label"
    data-test="grade"
  >
    <span :class="size === 'large' ? 'text-h3' : 'text-subtitle-1'" class="font-weight-bold">
      {{ grade ?? '–' }}
    </span>
  </v-avatar>
</template>

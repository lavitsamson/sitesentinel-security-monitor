<script setup lang="ts">
import { CHECK_STATUS_LABELS, type CheckStatus } from '@sitesentinel/shared';
import { CHECK_STATUS_COLORS, CHECK_STATUS_ICONS } from '../../utils/colors';

defineProps<{ status: CheckStatus }>();
</script>

<template>
  <v-chip
    :color="CHECK_STATUS_COLORS[status]"
    :prepend-icon="CHECK_STATUS_ICONS[status]"
    size="small"
    variant="tonal"
    label
  >
    {{ CHECK_STATUS_LABELS[status] }}
  </v-chip>
</template>

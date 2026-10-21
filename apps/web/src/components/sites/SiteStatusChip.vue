<script setup lang="ts">
import { SITE_STATUS_LABELS, type SiteStatus } from '@sitesentinel/shared';
import { SITE_STATUS_COLORS, SITE_STATUS_ICONS } from '../../utils/colors';

defineProps<{ status: SiteStatus }>();
</script>

<template>
  <v-chip
    :color="SITE_STATUS_COLORS[status]"
    :prepend-icon="SITE_STATUS_ICONS[status]"
    size="small"
    variant="tonal"
    label
  >
    {{ SITE_STATUS_LABELS[status] }}
  </v-chip>
</template>

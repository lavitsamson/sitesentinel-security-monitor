<script setup lang="ts">
defineProps<{ title: string; subtitle?: string }>();
</script>

<template>
  <v-container class="py-12" max-width="480">
    <v-card border flat class="pa-2 pa-sm-4">
      <v-card-item>
        <h1 class="text-h5">{{ title }}</h1>
        <p v-if="subtitle" class="text-body-2 text-medium-emphasis mt-1">{{ subtitle }}</p>
      </v-card-item>
      <v-card-text>
        <slot />
      </v-card-text>
      <v-card-actions v-if="$slots.footer" class="justify-center text-body-2 flex-wrap">
        <slot name="footer" />
      </v-card-actions>
    </v-card>
  </v-container>
</template>

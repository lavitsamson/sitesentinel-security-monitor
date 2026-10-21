<script setup lang="ts">
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
</script>

<template>
  <v-container class="py-8" max-width="960">
    <h1 class="text-h4 mb-2">Welcome, {{ auth.user?.name }}</h1>
    <p class="text-body-1 text-medium-emphasis mb-6">Signed in as {{ auth.user?.email }}.</p>

    <v-card border flat>
      <v-empty-state
        icon="mdi-web-check"
        title="Your sites will appear here"
        text="Grades, open incidents and recent changes for every verified site. The sites dashboard is being built next."
      />
    </v-card>
  </v-container>
</template>

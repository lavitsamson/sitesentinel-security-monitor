<script setup lang="ts">
import { watchEffect } from 'vue';
import { useTheme } from 'vuetify';
import { useThemeStore } from './stores/theme';

const themeStore = useThemeStore();
const theme = useTheme();

watchEffect(() => {
  theme.change(themeStore.name);
});
</script>

<template>
  <v-app>
    <a class="skip-link" href="#main">Skip to content</a>
    <v-app-bar flat border="b">
      <v-app-bar-title>
        <router-link to="/" class="brand">
          <v-icon icon="mdi-shield-check-outline" class="mr-2" aria-hidden="true" />
          SiteSentinel
        </router-link>
      </v-app-bar-title>
      <v-btn
        :icon="themeStore.name === 'dark' ? 'mdi-weather-sunny' : 'mdi-weather-night'"
        :aria-label="`Switch to ${themeStore.name === 'dark' ? 'light' : 'dark'} theme`"
        @click="themeStore.toggle()"
      />
    </v-app-bar>
    <v-main id="main" tabindex="-1">
      <router-view />
    </v-main>
  </v-app>
</template>

<style scoped>
.brand {
  color: inherit;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
}

.skip-link {
  position: absolute;
  left: -9999px;
  z-index: 10000;
  padding: 0.5rem 1rem;
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
}

.skip-link:focus {
  left: 1rem;
  top: 1rem;
}
</style>

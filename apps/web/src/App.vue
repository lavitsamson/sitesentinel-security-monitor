<script setup lang="ts">
import { ref, watchEffect } from 'vue';
import { useRouter } from 'vue-router';
import { useDisplay, useTheme } from 'vuetify';
import { useAuthStore } from './stores/auth';
import { useThemeStore } from './stores/theme';

const themeStore = useThemeStore();
const theme = useTheme();
const auth = useAuthStore();
const router = useRouter();
const { mdAndUp } = useDisplay();
/** Only used on small screens; on desktop the drawer is always shown. */
const drawerOpen = ref(false);

const navItems = [
  { title: 'Dashboard', icon: 'mdi-view-dashboard-outline', to: { name: 'dashboard' } },
  { title: 'Sites', icon: 'mdi-web', to: { name: 'sites' } },
  { title: 'Incidents', icon: 'mdi-alert-circle-outline', to: { name: 'incidents' } },
  { title: 'Alert channels', icon: 'mdi-bell-outline', to: { name: 'alert-channels' } },
  { title: 'Settings', icon: 'mdi-cog-outline', to: { name: 'settings' } },
];

watchEffect(() => {
  theme.change(themeStore.name);
});

async function signOut() {
  await auth.logout().catch(() => undefined);
  await router.push({ name: 'home' });
}
</script>

<template>
  <v-app>
    <a class="skip-link" href="#main">Skip to content</a>
    <v-app-bar flat border="b">
      <template v-if="auth.user && !mdAndUp" #prepend>
        <v-app-bar-nav-icon
          aria-label="Open navigation"
          :aria-expanded="drawerOpen"
          @click="drawerOpen = !drawerOpen"
        />
      </template>
      <v-app-bar-title>
        <router-link to="/" class="brand">
          <v-icon icon="mdi-shield-check-outline" class="mr-2" aria-hidden="true" />
          SiteSentinel
        </router-link>
      </v-app-bar-title>
      <template v-if="auth.ready">
        <v-menu v-if="auth.user" location="bottom end">
          <template #activator="{ props }">
            <v-btn v-bind="props" prepend-icon="mdi-account-circle-outline" data-test="user-menu">
              <span class="d-none d-sm-inline">{{ auth.user.name }}</span>
              <span class="d-sm-none">Account</span>
            </v-btn>
          </template>
          <v-list density="compact">
            <v-list-item :subtitle="auth.user.email" :title="auth.user.name" />
            <v-divider />
            <v-list-item :to="{ name: 'dashboard' }" prepend-icon="mdi-view-dashboard-outline">
              Dashboard
            </v-list-item>
            <v-list-item :to="{ name: 'settings' }" prepend-icon="mdi-cog-outline">
              Settings
            </v-list-item>
            <v-list-item prepend-icon="mdi-logout" data-test="sign-out" @click="signOut">
              Sign out
            </v-list-item>
          </v-list>
        </v-menu>
        <template v-else>
          <v-btn :to="{ name: 'login' }">Sign in</v-btn>
          <v-btn :to="{ name: 'register' }" variant="flat" color="primary" class="d-none d-sm-flex">
            Create account
          </v-btn>
        </template>
      </template>
      <v-btn
        :icon="themeStore.name === 'dark' ? 'mdi-weather-sunny' : 'mdi-weather-night'"
        :aria-label="`Switch to ${themeStore.name === 'dark' ? 'light' : 'dark'} theme`"
        @click="themeStore.toggle()"
      />
    </v-app-bar>
    <v-navigation-drawer
      v-if="auth.user"
      :model-value="mdAndUp || drawerOpen"
      :permanent="mdAndUp"
      :temporary="!mdAndUp"
      width="220"
      @update:model-value="drawerOpen = $event"
    >
      <nav aria-label="Main">
        <v-list nav density="comfortable">
          <v-list-item
            v-for="item in navItems"
            :key="item.title"
            :to="item.to"
            :prepend-icon="item.icon"
            :title="item.title"
            @click="drawerOpen = false"
          />
        </v-list>
      </nav>
    </v-navigation-drawer>
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

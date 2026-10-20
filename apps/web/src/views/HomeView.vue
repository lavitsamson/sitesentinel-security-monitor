<script setup lang="ts">
import ApiStatusCard from '../components/ApiStatusCard.vue';

const checks = [
  { icon: 'mdi-lock-outline', title: 'TLS certificate', text: 'Expiry, hostname match, protocol' },
  {
    icon: 'mdi-format-list-checks',
    title: 'Security headers',
    text: 'HSTS, CSP, framing, and more',
  },
  { icon: 'mdi-arrow-right-bold', title: 'HTTPS redirect', text: 'Plain HTTP upgrades to HTTPS' },
  { icon: 'mdi-email-lock-outline', title: 'Email DNS', text: 'MX, SPF and DMARC records' },
  { icon: 'mdi-file-document-outline', title: 'security.txt', text: 'Contact and expiry fields' },
  { icon: 'mdi-pulse', title: 'Uptime', text: 'Status code and response time' },
];
</script>

<template>
  <v-container class="py-8" max-width="960">
    <h1 class="text-h4 mb-2">Website security & health, graded A–F</h1>
    <p class="text-body-1 text-medium-emphasis mb-6">
      SiteSentinel runs scheduled, passive checks against domains you own and have verified, then
      tracks scores, incidents and alerts over time.
    </p>

    <v-alert type="info" variant="tonal" class="mb-8" title="Passive checks only">
      Normal HTTPS requests, TLS handshakes and public DNS lookups, exactly what a browser or mail
      server does. No port scanning, crawling or vulnerability probing, and only on verified
      domains.
    </v-alert>

    <v-row>
      <v-col cols="12" md="7">
        <h2 class="text-h6 mb-3">What gets checked</h2>
        <v-row dense>
          <v-col v-for="check in checks" :key="check.title" cols="12" sm="6">
            <v-card border flat height="100%">
              <v-card-item :prepend-icon="check.icon" :title="check.title" :subtitle="check.text" />
            </v-card>
          </v-col>
        </v-row>
      </v-col>
      <v-col cols="12" md="5">
        <h2 class="text-h6 mb-3">Status</h2>
        <ApiStatusCard />
      </v-col>
    </v-row>
  </v-container>
</template>

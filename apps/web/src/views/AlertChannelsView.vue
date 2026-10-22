<script setup lang="ts">
import {
  ALERT_CHANNEL_TYPE_LABELS,
  MAX_ALERT_CHANNELS,
  WEBHOOK_SIGNATURE_HEADER,
  type AlertChannel,
  type CreateAlertChannelInput,
} from '@sitesentinel/shared';
import { computed, onMounted, ref } from 'vue';
import { userMessage } from '../api/errors';
import AlertChannelDialog from '../components/alerts/AlertChannelDialog.vue';
import CopyField from '../components/CopyField.vue';
import { useAlertChannelsStore } from '../stores/alert-channels';
import { useAuthStore } from '../stores/auth';
import { dateTime } from '../utils/format';

const channels = useAlertChannelsStore();
const auth = useAuthStore();

const snackbar = ref({ show: false, text: '', color: 'success' });
const notify = (text: string, color = 'success') => (snackbar.value = { show: true, text, color });

const atLimit = computed(() => channels.items.length >= MAX_ALERT_CHANNELS);
const emailMuted = computed(() => auth.user?.notificationPrefs.emailAlerts === false);

const dialogOpen = ref(false);
const editing = ref<AlertChannel | null>(null);
/** A new webhook's signing secret: shown once, right after it is created. */
const newSecret = ref<string | null>(null);

const deleting = ref<AlertChannel | null>(null);
const removing = ref(false);

onMounted(() => {
  void channels.load();
});

function openAdd() {
  editing.value = null;
  dialogOpen.value = true;
}

function openEdit(channel: AlertChannel) {
  editing.value = channel;
  dialogOpen.value = true;
}

async function save(input: CreateAlertChannelInput) {
  if (editing.value) {
    await channels.update(editing.value.id, { name: input.name, target: input.target });
    notify('Channel saved.');
    return;
  }
  const created = await channels.create(input);
  if (created.secret) newSecret.value = created.secret;
  else notify('Channel added. Send a test to check it works.');
}

async function setActive(channel: AlertChannel, active: boolean) {
  try {
    await channels.update(channel.id, { active });
    notify(active ? `${channel.name} will receive alerts.` : `${channel.name} is paused.`);
  } catch (err) {
    notify(userMessage(err), 'error');
  }
}

async function sendTest(channel: AlertChannel) {
  try {
    const outcome = await channels.sendTest(channel.id);
    if (outcome === 'SENT') notify(`Test alert delivered to ${channel.name}.`);
    else if (outcome === 'FAILED') notify(`Test alert to ${channel.name} failed.`, 'error');
    else notify('The test is queued but has not been delivered yet. Check back shortly.', 'info');
  } catch (err) {
    notify(userMessage(err), 'error');
  }
}

async function confirmRemove() {
  if (!deleting.value) return;
  removing.value = true;
  try {
    await channels.remove(deleting.value.id);
    notify('Channel deleted.');
    deleting.value = null;
  } catch (err) {
    notify(userMessage(err), 'error');
  } finally {
    removing.value = false;
  }
}

const deleteOpen = computed({
  get: () => deleting.value !== null,
  set: (open) => {
    if (!open) deleting.value = null;
  },
});
const secretOpen = computed({
  get: () => newSecret.value !== null,
  set: (open) => {
    if (!open) newSecret.value = null;
  },
});
</script>

<template>
  <v-container class="py-8" max-width="960">
    <div class="d-flex flex-wrap align-center ga-4 mb-2">
      <h1 class="text-h4">Alert channels</h1>
      <v-spacer />
      <v-btn
        color="primary"
        variant="flat"
        prepend-icon="mdi-plus"
        :disabled="atLimit"
        data-test="add-channel"
        @click="openAdd"
      >
        Add channel
      </v-btn>
    </div>
    <p class="text-body-1 text-medium-emphasis mb-6">
      Every active channel is told when an incident opens or resolves, once per change.
      <template v-if="atLimit">You can have up to {{ MAX_ALERT_CHANNELS }} channels.</template>
    </p>

    <v-alert v-if="emailMuted" type="info" variant="tonal" class="mb-4" data-test="email-muted">
      Email alerts are turned off in your
      <router-link :to="{ name: 'settings' }">settings</router-link>; only webhooks are sent.
    </v-alert>

    <v-alert v-if="channels.error" type="error" variant="tonal" class="mb-4" role="alert">
      {{ channels.error }}
      <template #append>
        <v-btn variant="text" @click="channels.load()">Retry</v-btn>
      </template>
    </v-alert>

    <v-skeleton-loader
      v-if="channels.loading && channels.items.length === 0"
      type="list-item-two-line@3"
      aria-label="Loading alert channels"
    />

    <v-card v-else-if="channels.items.length === 0 && !channels.error" border flat>
      <v-empty-state
        icon="mdi-bell-outline"
        title="No alert channels yet"
        text="Add an email address or a webhook (Slack-compatible) to hear about incidents."
      >
        <template #actions>
          <v-btn color="primary" variant="flat" @click="openAdd">Add channel</v-btn>
        </template>
      </v-empty-state>
    </v-card>

    <v-card v-else border flat>
      <v-list lines="three" data-test="channels">
        <template v-for="(channel, i) in channels.items" :key="channel.id">
          <v-divider v-if="i > 0" />
          <v-list-item :data-test="`channel-${channel.id}`">
            <template #prepend>
              <v-icon
                :icon="channel.type === 'EMAIL' ? 'mdi-email-outline' : 'mdi-webhook'"
                aria-hidden="true"
              />
            </template>
            <v-list-item-title class="font-weight-medium">
              {{ channel.name }}
              <v-chip size="x-small" label class="ml-2">
                {{ ALERT_CHANNEL_TYPE_LABELS[channel.type] }}
              </v-chip>
              <v-chip v-if="!channel.active" size="x-small" label color="warning" class="ml-1">
                Paused
              </v-chip>
            </v-list-item-title>
            <v-list-item-subtitle class="text-break">{{ channel.target }}</v-list-item-subtitle>
            <div class="text-body-2 mt-1" data-test="last-delivery">
              <template v-if="channel.lastDelivery">
                <v-icon
                  :icon="
                    channel.lastDelivery.status === 'SENT'
                      ? 'mdi-check-circle-outline'
                      : 'mdi-alert-circle-outline'
                  "
                  :color="channel.lastDelivery.status === 'SENT' ? 'success' : 'error'"
                  size="small"
                  aria-hidden="true"
                />
                {{ channel.lastDelivery.status === 'SENT' ? 'Delivered' : 'Failed' }}
                {{ dateTime(channel.lastDelivery.at) }}
                <span v-if="channel.lastDelivery.error" class="text-medium-emphasis">
                  · {{ channel.lastDelivery.error }}
                </span>
              </template>
              <span v-else class="text-medium-emphasis">Nothing sent yet</span>
            </div>
            <template #append>
              <div class="d-flex flex-wrap align-center justify-end ga-1">
                <v-switch
                  :model-value="channel.active"
                  color="primary"
                  density="compact"
                  hide-details
                  inset
                  :aria-label="`Send alerts to ${channel.name}`"
                  @update:model-value="setActive(channel, Boolean($event))"
                />
                <v-btn
                  variant="text"
                  prepend-icon="mdi-send-outline"
                  :loading="channels.testing.has(channel.id)"
                  :data-test="`test-${channel.id}`"
                  @click="sendTest(channel)"
                >
                  Test
                </v-btn>
                <v-btn
                  icon="mdi-pencil-outline"
                  variant="text"
                  size="small"
                  :aria-label="`Edit ${channel.name}`"
                  @click="openEdit(channel)"
                />
                <v-btn
                  icon="mdi-delete-outline"
                  variant="text"
                  size="small"
                  :aria-label="`Delete ${channel.name}`"
                  @click="deleting = channel"
                />
              </div>
            </template>
          </v-list-item>
        </template>
      </v-list>
    </v-card>

    <AlertChannelDialog v-model="dialogOpen" :channel="editing" :save="save" />

    <v-dialog v-model="secretOpen" max-width="560" persistent>
      <v-card title="Save your signing secret">
        <v-card-text>
          <p class="mb-4">
            Each alert carries an <code>{{ WEBHOOK_SIGNATURE_HEADER }}</code> header:
            <code>t=&lt;unix time&gt;,v1=&lt;HMAC-SHA256&gt;</code> over
            <code>"&lt;t&gt;.&lt;raw body&gt;"</code>. Verify it with this secret to be sure an
            alert came from SiteSentinel.
          </p>
          <CopyField v-if="newSecret" label="Signing secret" :value="newSecret" />
          <v-alert type="warning" variant="tonal" class="mt-4" density="compact">
            This is the only time the secret is shown. To get a new one, delete the channel and add
            it again.
          </v-alert>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn color="primary" variant="flat" data-test="secret-done" @click="newSecret = null">
            I've saved it
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="deleteOpen" max-width="440">
      <v-card :title="`Delete ${deleting?.name ?? 'channel'}?`">
        <v-card-text>It stops receiving alerts, and its delivery history is deleted.</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="deleting = null">Cancel</v-btn>
          <v-btn
            color="error"
            variant="flat"
            :loading="removing"
            data-test="delete-confirm"
            @click="confirmRemove"
          >
            Delete
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snackbar.show" :color="snackbar.color" timeout="6000">
      {{ snackbar.text }}
    </v-snackbar>
  </v-container>
</template>

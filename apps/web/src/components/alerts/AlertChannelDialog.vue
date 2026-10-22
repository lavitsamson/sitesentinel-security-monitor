<script setup lang="ts">
import {
  ALERT_CHANNEL_TYPE_LABELS,
  ALERT_CHANNEL_TYPES,
  createAlertChannelSchema,
  type AlertChannel,
  type AlertChannelType,
  type CreateAlertChannelInput,
} from '@sitesentinel/shared';
import { computed, ref, watch } from 'vue';
import { ApiError } from '../../api/client';
import { userMessage } from '../../api/errors';
import { useReturnFocus } from '../../composables/return-focus';

const props = defineProps<{
  /** The channel to edit; omitted to add a new one. */
  channel?: AlertChannel | null;
  save: (input: CreateAlertChannelInput) => Promise<unknown>;
}>();
const open = defineModel<boolean>({ required: true });
useReturnFocus(open);

const type = ref<AlertChannelType>('EMAIL');
const name = ref('');
const target = ref('');
const fieldErrors = ref<Partial<Record<'name' | 'target', string>>>({});
const error = ref<string | null>(null);
const saving = ref(false);

const editing = computed(() => Boolean(props.channel));
const typeItems = ALERT_CHANNEL_TYPES.map((value) => ({
  value,
  title: ALERT_CHANNEL_TYPE_LABELS[value],
}));
const targetField = computed(() =>
  type.value === 'EMAIL'
    ? { label: 'Email address', type: 'email', placeholder: 'oncall@example.com', hint: '' }
    : {
        label: 'Webhook URL',
        type: 'url',
        placeholder: 'https://hooks.slack.com/services/…',
        hint: 'An https:// URL on a public host. Alerts are JSON, signed with HMAC-SHA256.',
      },
);

watch(
  open,
  (isOpen) => {
    if (!isOpen) return;
    type.value = props.channel?.type ?? 'EMAIL';
    name.value = props.channel?.name ?? '';
    target.value = props.channel?.target ?? '';
    fieldErrors.value = {};
    error.value = null;
  },
  { immediate: true },
);

async function submit() {
  // The same rules as the API, so most mistakes are caught before a request.
  const parsed = createAlertChannelSchema.safeParse({
    type: type.value,
    name: name.value,
    target: target.value,
  });
  fieldErrors.value = {};
  error.value = null;
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if ((field === 'name' || field === 'target') && !fieldErrors.value[field]) {
        fieldErrors.value[field] = issue.message;
      }
    }
    return;
  }
  saving.value = true;
  try {
    await props.save(parsed.data);
    open.value = false;
  } catch (err) {
    // The API also refuses internal webhook hosts, which only it checks.
    const targetError =
      err instanceof ApiError && err.problem?.errors?.find((e) => e.path === 'target');
    if (targetError) fieldErrors.value.target = err.problem?.detail ?? targetError.message;
    else error.value = userMessage(err);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <v-dialog v-model="open" max-width="520">
    <v-card :title="editing ? 'Edit alert channel' : 'Add alert channel'">
      <form novalidate data-test="channel-form" @submit.prevent="submit">
        <v-card-text>
          <v-alert v-if="error" type="error" variant="tonal" class="mb-4" role="alert">
            {{ error }}
          </v-alert>
          <v-radio-group
            v-if="!editing"
            v-model="type"
            label="Type"
            inline
            hide-details
            class="mb-4"
            data-test="channel-type"
          >
            <v-radio
              v-for="item in typeItems"
              :key="item.value"
              :label="item.title"
              :value="item.value"
            />
          </v-radio-group>
          <v-text-field
            v-model="name"
            label="Name"
            placeholder="On-call team"
            :error-messages="fieldErrors.name"
            class="mb-2"
            data-test="channel-name"
          />
          <v-text-field
            v-model="target"
            :label="targetField.label"
            :type="targetField.type"
            :placeholder="targetField.placeholder"
            :hint="targetField.hint"
            :persistent-hint="Boolean(targetField.hint)"
            :error-messages="fieldErrors.target"
            data-test="channel-target"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="open = false">Cancel</v-btn>
          <v-btn
            type="submit"
            color="primary"
            variant="flat"
            :loading="saving"
            data-test="channel-save"
          >
            {{ editing ? 'Save' : 'Add channel' }}
          </v-btn>
        </v-card-actions>
      </form>
    </v-card>
  </v-dialog>
</template>

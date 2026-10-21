<script setup lang="ts">
import {
  CHECK_INTERVAL_LABELS,
  CHECK_INTERVAL_MINUTES,
  MAX_TAGS,
  updateSiteSchema,
  type CheckIntervalMinutes,
  type Site,
  type UpdateSiteInput,
} from '@sitesentinel/shared';
import { ref, watch } from 'vue';
import { userMessage } from '../../api/errors';

const props = defineProps<{ site: Site; save: (patch: UpdateSiteInput) => Promise<unknown> }>();
const open = defineModel<boolean>({ required: true });

const displayName = ref('');
const interval = ref<CheckIntervalMinutes>(60);
const tags = ref<string[]>([]);
const error = ref<string | null>(null);
const saving = ref(false);

const intervalItems = CHECK_INTERVAL_MINUTES.map((m) => ({
  title: CHECK_INTERVAL_LABELS[m],
  value: m,
}));

// Fresh values each time the dialog opens.
watch(
  open,
  (isOpen) => {
    if (!isOpen) return;
    displayName.value = props.site.displayName;
    interval.value = props.site.checkIntervalMinutes;
    tags.value = [...props.site.tags];
    error.value = null;
  },
  { immediate: true },
);

async function submit() {
  const parsed = updateSiteSchema.safeParse({
    displayName: displayName.value,
    // Demo sites are fixed at daily checks; don't send a value the API would reject.
    ...(!props.site.demo && { checkIntervalMinutes: interval.value }),
    tags: tags.value,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    error.value = issue?.path[0] === 'tags' ? `Tags: ${issue.message}` : (issue?.message ?? null);
    return;
  }
  saving.value = true;
  error.value = null;
  try {
    await props.save(parsed.data);
    open.value = false;
  } catch (err) {
    error.value = userMessage(err);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <v-dialog v-model="open" max-width="520">
    <v-card title="Site settings">
      <form novalidate @submit.prevent="submit">
        <v-card-text>
          <v-alert v-if="error" type="error" variant="tonal" class="mb-4" role="alert">
            {{ error }}
          </v-alert>
          <v-text-field v-model="displayName" label="Display name" class="mb-2" />
          <v-select
            v-model="interval"
            :items="intervalItems"
            label="Check every"
            :disabled="site.demo"
            :hint="site.demo ? 'Demo sites are checked once a day.' : undefined"
            :persistent-hint="site.demo"
            class="mb-2"
          />
          <v-combobox
            v-model="tags"
            label="Tags"
            multiple
            chips
            closable-chips
            :hint="`Press Enter after each tag; up to ${MAX_TAGS}.`"
            persistent-hint
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="open = false">Cancel</v-btn>
          <v-btn type="submit" color="primary" variant="flat" :loading="saving">Save</v-btn>
        </v-card-actions>
      </form>
    </v-card>
  </v-dialog>
</template>

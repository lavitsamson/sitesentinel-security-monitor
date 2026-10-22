<script setup lang="ts">
import { tagSchema, type BulkSiteAction } from '@sitesentinel/shared';
import { ref } from 'vue';
import { useReturnFocus } from '../../composables/return-focus';
import { plural } from '../../utils/format';

defineProps<{ count: number; busy?: boolean }>();
const emit = defineEmits<{
  run: [request: { action: BulkSiteAction; tag?: string }];
  clear: [];
}>();

const tagDialog = ref(false);
const tag = ref('');
const tagError = ref<string | undefined>();
const deleteDialog = ref(false);
useReturnFocus(tagDialog);
useReturnFocus(deleteDialog);

function submitTag() {
  const parsed = tagSchema.safeParse(tag.value);
  if (!parsed.success) {
    tagError.value = parsed.error.issues[0]?.message ?? 'Invalid tag';
    return;
  }
  tagDialog.value = false;
  emit('run', { action: 'ADD_TAG', tag: parsed.data });
  tag.value = '';
  tagError.value = undefined;
}

function confirmDelete() {
  deleteDialog.value = false;
  emit('run', { action: 'DELETE' });
}
</script>

<template>
  <v-toolbar
    color="primary"
    density="compact"
    rounded="lg"
    class="px-2 mb-3"
    role="region"
    aria-label="Bulk actions"
    data-test="bulk-bar"
  >
    <span class="text-body-2 font-weight-medium mx-2" aria-live="polite" data-test="bulk-count">
      {{ plural(count, 'site') }} selected
    </span>
    <v-spacer />
    <div class="d-flex flex-wrap ga-1">
      <v-btn
        :disabled="busy"
        prepend-icon="mdi-play-circle-outline"
        data-test="bulk-CHECK_NOW"
        @click="emit('run', { action: 'CHECK_NOW' })"
      >
        Check now
      </v-btn>
      <v-btn
        :disabled="busy"
        prepend-icon="mdi-pause"
        data-test="bulk-PAUSE"
        @click="emit('run', { action: 'PAUSE' })"
      >
        Pause
      </v-btn>
      <v-btn
        :disabled="busy"
        prepend-icon="mdi-play"
        data-test="bulk-RESUME"
        @click="emit('run', { action: 'RESUME' })"
      >
        Resume
      </v-btn>
      <v-btn
        :disabled="busy"
        prepend-icon="mdi-tag-plus-outline"
        data-test="bulk-ADD_TAG"
        @click="tagDialog = true"
      >
        Add tag
      </v-btn>
      <v-btn
        :disabled="busy"
        prepend-icon="mdi-delete-outline"
        data-test="bulk-DELETE"
        @click="deleteDialog = true"
      >
        Delete
      </v-btn>
      <v-btn icon="mdi-close" aria-label="Clear selection" @click="emit('clear')" />
    </div>

    <v-dialog v-model="tagDialog" max-width="400">
      <v-card title="Add a tag">
        <form novalidate @submit.prevent="submitTag">
          <v-card-text>
            <v-text-field
              v-model="tag"
              label="Tag"
              hint="Letters, digits, - and _"
              persistent-hint
              :error-messages="tagError"
              autofocus
              data-test="bulk-tag-input"
            />
          </v-card-text>
          <v-card-actions>
            <v-spacer />
            <v-btn @click="tagDialog = false">Cancel</v-btn>
            <v-btn type="submit" color="primary" variant="flat" data-test="bulk-tag-submit">
              Add to {{ plural(count, 'site') }}
            </v-btn>
          </v-card-actions>
        </form>
      </v-card>
    </v-dialog>

    <v-dialog v-model="deleteDialog" max-width="440">
      <v-card :title="`Delete ${plural(count, 'site')}?`">
        <v-card-text>
          Their check history and incidents are deleted too. This cannot be undone.
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="deleteDialog = false">Cancel</v-btn>
          <v-btn
            color="error"
            variant="flat"
            data-test="bulk-delete-confirm"
            @click="confirmDelete"
          >
            Delete
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-toolbar>
</template>

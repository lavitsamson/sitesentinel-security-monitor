<script setup lang="ts">
import { ref } from 'vue';

defineProps<{
  label: string;
  autocomplete: 'current-password' | 'new-password';
  errorMessages?: string | string[] | undefined;
  hint?: string;
}>();
const model = defineModel<string>({ default: '' });
const visible = ref(false);
</script>

<template>
  <v-text-field
    v-model="model"
    :label="label"
    :type="visible ? 'text' : 'password'"
    :autocomplete="autocomplete"
    :error-messages="errorMessages"
    :hint="hint"
    :persistent-hint="!!hint"
    prepend-inner-icon="mdi-lock-outline"
  >
    <template #append-inner>
      <v-btn
        :icon="visible ? 'mdi-eye-off-outline' : 'mdi-eye-outline'"
        :aria-label="visible ? 'Hide password' : 'Show password'"
        :aria-pressed="visible"
        variant="text"
        size="small"
        density="comfortable"
        @click="visible = !visible"
      />
    </template>
  </v-text-field>
</template>

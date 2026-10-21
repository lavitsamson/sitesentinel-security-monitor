<script setup lang="ts">
import { ref } from 'vue';

const props = defineProps<{ label: string; value: string }>();
const copied = ref(false);
let reset: ReturnType<typeof setTimeout> | undefined;

async function copy() {
  try {
    await navigator.clipboard.writeText(props.value);
    copied.value = true;
    clearTimeout(reset);
    reset = setTimeout(() => (copied.value = false), 2000);
  } catch {
    // Clipboard blocked (insecure context or denied): the value is selectable instead.
  }
}
</script>

<template>
  <v-text-field
    :label="label"
    :model-value="value"
    readonly
    variant="outlined"
    density="compact"
    class="copy-field"
    :hint="copied ? 'Copied to clipboard' : undefined"
    persistent-hint
    @focus="($event.target as HTMLInputElement).select()"
  >
    <template #append-inner>
      <v-btn
        :icon="copied ? 'mdi-check' : 'mdi-content-copy'"
        :aria-label="`Copy ${label}`"
        variant="text"
        size="small"
        @click="copy"
      />
    </template>
  </v-text-field>
  <span class="d-sr-only" aria-live="polite">{{ copied ? `${label} copied` : '' }}</span>
</template>

<style scoped>
.copy-field :deep(input) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
</style>

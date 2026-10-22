<script setup lang="ts">
/**
 * A list of links, for use instead of <v-list> when its items navigate.
 * Vuetify's v-list puts role="link" items directly under role="list" (invalid
 * ARIA) and makes the whole list a single tab stop with arrow keys inside, so
 * links are hidden from Tab. Here it's a real <ul>; put an <li> with a
 * standalone <v-list-item :to> in the slot, and every link is a tab stop.
 */
withDefaults(defineProps<{ divided?: boolean; nav?: boolean }>(), {
  divided: false,
  nav: false,
});
</script>

<template>
  <ul class="link-list" :class="{ 'link-list--divided': divided, 'link-list--nav': nav }">
    <slot />
  </ul>
</template>

<style scoped>
.link-list {
  list-style: none;
  margin: 0;
  padding: 8px 0;
}

.link-list--nav {
  padding: 8px;
}

.link-list--nav > :slotted(li + li) {
  margin-top: 4px;
}

.link-list--divided > :slotted(li + li) {
  border-top: thin solid rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import { useThemeStore } from './theme';

describe('theme store', () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it('restores a saved preference', () => {
    localStorage.setItem('sitesentinel.theme', 'dark');

    expect(useThemeStore().name).toBe('dark');
  });

  it('toggles and persists the theme', async () => {
    const store = useThemeStore();
    const start = store.name;

    store.toggle();
    await nextTick();

    expect(store.name).not.toBe(start);
    expect(localStorage.getItem('sitesentinel.theme')).toBe(store.name);
  });
});

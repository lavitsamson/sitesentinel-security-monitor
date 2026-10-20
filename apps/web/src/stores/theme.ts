import { defineStore } from 'pinia';
import { ref, watch } from 'vue';

export type ThemeName = 'light' | 'dark';

const STORAGE_KEY = 'sitesentinel.theme';

function initialTheme(): ThemeName {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // Storage can be unavailable (privacy mode); fall back to the OS preference.
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export const useThemeStore = defineStore('theme', () => {
  const name = ref<ThemeName>(initialTheme());

  function toggle() {
    name.value = name.value === 'dark' ? 'light' : 'dark';
  }

  watch(name, (value) => {
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // Not persisting is acceptable; the toggle still works for this session.
    }
  });

  return { name, toggle };
});

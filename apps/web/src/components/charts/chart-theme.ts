import { computed } from 'vue';
import { useTheme } from 'vuetify';

/** `#rrggbb` → `rgba(r, g, b, alpha)`. */
export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Chart colours from the active Vuetify theme, so charts follow light/dark mode. */
export function useChartTheme() {
  const theme = useTheme();
  return computed(() => {
    const colors = theme.current.value.colors;
    const text = colors['on-surface'] ?? '#000000';
    return {
      colors,
      text: withAlpha(text, 0.75),
      grid: withAlpha(text, 0.12),
      primary: colors.primary ?? '#1d4ed8',
      primaryFill: withAlpha(colors.primary ?? '#1d4ed8', 0.12),
      surface: colors.surface ?? '#ffffff',
    };
  });
}

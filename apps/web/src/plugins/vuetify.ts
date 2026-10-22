import { createVuetify, type ThemeDefinition } from 'vuetify';

// Brand colours chosen to meet WCAG AA (4.5:1) for text on their surfaces.
const light: ThemeDefinition = {
  dark: false,
  colors: {
    background: '#f6f7f9',
    surface: '#ffffff',
    primary: '#1d4ed8',
    secondary: '#475569',
    success: '#15803d',
    warning: '#b45309',
    error: '#b91c1c',
    info: '#0369a1',
    // Grades A→F, green to red; each ≥ 4.5:1 against white and the light background.
    'grade-a': '#15803d',
    'grade-b': '#4d7c0f',
    'grade-c': '#a16207',
    'grade-d': '#c2410c',
    'grade-f': '#b91c1c',
  },
  variables: {
    // Vuetify's 0.6 renders secondary text (field labels, hints, subtitles) at
    // about #7a7a7a, under 4.5:1 on white and on filled fields; 0.68 clears it.
    'medium-emphasis-opacity': 0.68,
  },
};

const dark: ThemeDefinition = {
  dark: true,
  colors: {
    background: '#0f172a',
    surface: '#1e293b',
    primary: '#93c5fd',
    secondary: '#cbd5e1',
    success: '#86efac',
    warning: '#fcd34d',
    error: '#fca5a5',
    info: '#7dd3fc',
    // Light tints for text on dark surfaces; each ≥ 4.5:1 against the dark surface.
    'grade-a': '#86efac',
    'grade-b': '#bef264',
    'grade-c': '#fde047',
    'grade-d': '#fdba74',
    'grade-f': '#fca5a5',
  },
};

export const vuetify = createVuetify({
  theme: {
    defaultTheme: 'light',
    themes: { light, dark },
  },
});

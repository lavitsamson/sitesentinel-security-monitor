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
  },
};

export const vuetify = createVuetify({
  theme: {
    defaultTheme: 'light',
    themes: { light, dark },
  },
});

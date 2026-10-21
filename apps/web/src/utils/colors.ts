import type { CheckStatus, Grade, Severity, SiteStatus } from '@sitesentinel/shared';

/**
 * Theme colour names for each state (defined in plugins/vuetify.ts for both
 * themes). Colour is never the only signal: every chip also shows its label.
 */
export const GRADE_COLORS: Record<Grade, string> = {
  A: 'grade-a',
  B: 'grade-b',
  C: 'grade-c',
  D: 'grade-d',
  F: 'grade-f',
};
export const UNGRADED_COLOR = 'secondary';

export const SITE_STATUS_COLORS: Record<SiteStatus, string> = {
  UP: 'success',
  DEGRADED: 'warning',
  DOWN: 'error',
  UNKNOWN: 'secondary',
};

export const SITE_STATUS_ICONS: Record<SiteStatus, string> = {
  UP: 'mdi-arrow-up-circle-outline',
  DEGRADED: 'mdi-alert-circle-outline',
  DOWN: 'mdi-arrow-down-circle-outline',
  UNKNOWN: 'mdi-help-circle-outline',
};

export const CHECK_STATUS_COLORS: Record<CheckStatus, string> = {
  PASS: 'success',
  WARN: 'warning',
  FAIL: 'error',
  ERROR: 'secondary',
};

export const CHECK_STATUS_ICONS: Record<CheckStatus, string> = {
  PASS: 'mdi-check-circle-outline',
  WARN: 'mdi-alert-outline',
  FAIL: 'mdi-close-circle-outline',
  ERROR: 'mdi-help-circle-outline',
};

export const SEVERITY_COLORS: Record<Severity, string> = {
  high: 'error',
  medium: 'warning',
  low: 'info',
  info: 'secondary',
};

export const SEVERITY_ICONS: Record<Severity, string> = {
  high: 'mdi-alert-octagon-outline',
  medium: 'mdi-alert-outline',
  low: 'mdi-information-outline',
  info: 'mdi-lightbulb-outline',
};

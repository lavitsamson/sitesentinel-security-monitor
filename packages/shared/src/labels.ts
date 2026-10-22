import type { AlertChannelType } from './alerts.js';
import type {
  CheckIntervalMinutes,
  CheckStatus,
  CheckType,
  SiteStatus,
  VerificationMethod,
} from './enums.js';

/**
 * Human-readable names for enum values, shared by the web app and (later) the
 * PDF report so both describe a check the same way.
 */
export const CHECK_TYPE_LABELS: Record<CheckType, string> = {
  TLS: 'TLS certificate',
  SECURITY_HEADERS: 'Security headers',
  HTTPS_REDIRECT: 'HTTPS redirect',
  EMAIL_DNS: 'Email DNS',
  SECURITY_TXT: 'security.txt',
  UPTIME: 'Uptime',
};

export const CHECK_TYPE_DESCRIPTIONS: Record<CheckType, string> = {
  TLS: 'Certificate validity, expiry, hostname match and protocol version.',
  SECURITY_HEADERS: 'HSTS, Content-Security-Policy, framing and other protective headers.',
  HTTPS_REDIRECT: 'Plain HTTP requests are permanently redirected to HTTPS.',
  EMAIL_DNS: 'MX, SPF and DMARC records that stop others sending mail as you.',
  SECURITY_TXT: 'A /.well-known/security.txt telling researchers how to reach you.',
  UPTIME: 'The homepage responds, and how quickly.',
};

export const CHECK_STATUS_LABELS: Record<CheckStatus, string> = {
  PASS: 'Pass',
  WARN: 'Warning',
  FAIL: 'Fail',
  ERROR: 'Error',
};

export const SITE_STATUS_LABELS: Record<SiteStatus, string> = {
  UP: 'Up',
  DOWN: 'Down',
  DEGRADED: 'Degraded',
  UNKNOWN: 'Unknown',
};

export const VERIFICATION_METHOD_LABELS: Record<VerificationMethod, string> = {
  DNS_TXT: 'DNS TXT record',
  WELL_KNOWN_FILE: 'File on your website',
};

export const CHECK_INTERVAL_LABELS: Record<CheckIntervalMinutes, string> = {
  5: 'Every 5 minutes',
  15: 'Every 15 minutes',
  60: 'Hourly',
  1440: 'Daily',
};

export const ALERT_CHANNEL_TYPE_LABELS: Record<AlertChannelType, string> = {
  EMAIL: 'Email',
  WEBHOOK: 'Webhook',
};

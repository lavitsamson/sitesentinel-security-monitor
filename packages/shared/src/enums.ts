import { z } from 'zod';

/** The six passive checks SiteSentinel runs (CLAUDE.md §6). */
export const CHECK_TYPES = [
  'TLS',
  'SECURITY_HEADERS',
  'HTTPS_REDIRECT',
  'EMAIL_DNS',
  'SECURITY_TXT',
  'UPTIME',
] as const;
export const checkTypeSchema = z.enum(CHECK_TYPES);
export type CheckType = z.infer<typeof checkTypeSchema>;

export const CHECK_STATUSES = ['PASS', 'WARN', 'FAIL', 'ERROR'] as const;
export const checkStatusSchema = z.enum(CHECK_STATUSES);
export type CheckStatus = z.infer<typeof checkStatusSchema>;

export const SEVERITIES = ['info', 'low', 'medium', 'high'] as const;
export const severitySchema = z.enum(SEVERITIES);
export type Severity = z.infer<typeof severitySchema>;

export const SITE_STATUSES = ['UP', 'DOWN', 'DEGRADED', 'UNKNOWN'] as const;
export const siteStatusSchema = z.enum(SITE_STATUSES);
export type SiteStatus = z.infer<typeof siteStatusSchema>;

export const GRADES = ['A', 'B', 'C', 'D', 'F'] as const;
export const gradeSchema = z.enum(GRADES);
export type Grade = z.infer<typeof gradeSchema>;

export const VERIFICATION_METHODS = ['DNS_TXT', 'WELL_KNOWN_FILE'] as const;
export const verificationMethodSchema = z.enum(VERIFICATION_METHODS);
export type VerificationMethod = z.infer<typeof verificationMethodSchema>;

/** Allowed check intervals in minutes: 5 min, 15 min, hourly, daily. */
export const CHECK_INTERVAL_MINUTES = [5, 15, 60, 1440] as const;
export const checkIntervalSchema = z.union(CHECK_INTERVAL_MINUTES.map((m) => z.literal(m)));
export type CheckIntervalMinutes = (typeof CHECK_INTERVAL_MINUTES)[number];

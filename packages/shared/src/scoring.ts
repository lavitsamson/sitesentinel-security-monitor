import type { CheckStatus, CheckType, Grade, Severity } from './enums.js';

/**
 * Scoring rules, shared by the checks, the workers (overall score) and the UI
 * (explaining a grade). Every number that turns findings into a grade lives here.
 */

/** Weight of each check in the overall site score (CLAUDE.md §6). Sums to 100. */
export const CHECK_WEIGHTS: Record<CheckType, number> = {
  TLS: 30,
  SECURITY_HEADERS: 25,
  HTTPS_REDIRECT: 15,
  EMAIL_DNS: 15,
  SECURITY_TXT: 5,
  UPTIME: 10,
};

/** Lowest score for each grade, best first. Anything below the last is an F. */
export const GRADE_THRESHOLDS: readonly (readonly [Exclude<Grade, 'F'>, number])[] = [
  ['A', 90],
  ['B', 80],
  ['C', 70],
  ['D', 60],
];

export function gradeFor(score: number): Grade {
  for (const [grade, min] of GRADE_THRESHOLDS) if (score >= min) return grade;
  return 'F';
}

/**
 * Points a finding takes off a check's 100. Checks other than SECURITY_HEADERS
 * score as `100 - sum(penalties)`, floored at 0. Hard failures (expired
 * certificate, site down, plain-HTTP site) score 0 outright.
 */
export const SEVERITY_PENALTY: Record<Severity, number> = {
  info: 0,
  low: 10,
  medium: 25,
  high: 50,
};

export function scoreFromFindings(findings: readonly { severity: Severity }[]): number {
  const penalty = findings.reduce((sum, f) => sum + SEVERITY_PENALTY[f.severity], 0);
  return Math.max(0, 100 - penalty);
}

/**
 * Status from the worst finding: any high → FAIL, any medium → WARN, otherwise
 * PASS (low and info findings are advice, not problems).
 */
export function statusFromFindings(findings: readonly { severity: Severity }[]): CheckStatus {
  if (findings.some((f) => f.severity === 'high')) return 'FAIL';
  if (findings.some((f) => f.severity === 'medium')) return 'WARN';
  return 'PASS';
}

/**
 * SECURITY_HEADERS is scored by points earned per header rather than by penalty.
 * The maximum for each sums to 100; partial credit rules:
 *
 * - `hsts`: full with max-age ≥ 15552000 (180 days) and includeSubDomains; −5
 *   without includeSubDomains; half if max-age is shorter; 0 if missing or max-age=0.
 * - `csp`: full if present and strict; −8 each for `unsafe-inline`, `unsafe-eval`
 *   and a wildcard source, never below 5 while a policy is present.
 * - `contentTypeOptions`: all or nothing for `nosniff`.
 * - `clickjacking`: full for CSP `frame-ancestors` or X-Frame-Options DENY/SAMEORIGIN.
 * - `referrerPolicy`: full for a privacy-preserving policy; half for `unsafe-url`
 *   or `no-referrer-when-downgrade`.
 * - `permissionsPolicy`: all or nothing.
 * - `noVersionLeak`: lost if `Server` or `X-Powered-By` reveals a version number.
 */
export const SECURITY_HEADER_POINTS = {
  hsts: 25,
  csp: 25,
  contentTypeOptions: 10,
  clickjacking: 15,
  referrerPolicy: 10,
  permissionsPolicy: 10,
  noVersionLeak: 5,
} as const;
export type SecurityHeaderKey = keyof typeof SECURITY_HEADER_POINTS;

export const HSTS_MIN_MAX_AGE = 15_552_000;
export const CSP_WEAKNESS_PENALTY = 8;
export const CSP_MIN_POINTS = 5;

/** SECURITY_HEADERS status by score: ≥ 80 PASS, ≥ 50 WARN, else FAIL. */
export const SECURITY_HEADERS_STATUS_THRESHOLDS = { pass: 80, warn: 50 } as const;

export function securityHeadersStatus(score: number): CheckStatus {
  if (score >= SECURITY_HEADERS_STATUS_THRESHOLDS.pass) return 'PASS';
  if (score >= SECURITY_HEADERS_STATUS_THRESHOLDS.warn) return 'WARN';
  return 'FAIL';
}

export interface ScoredCheck {
  type: CheckType;
  status: CheckStatus;
  score: number;
}

/**
 * Weighted average of the latest result per check type. ERROR results (the check
 * couldn't run) and missing checks are left out and the remaining weights
 * renormalised, so a transient checker problem doesn't drag a grade down.
 * Returns null when nothing has been scored yet.
 */
export function overallScore(results: readonly ScoredCheck[]): number | null {
  const latest = new Map<CheckType, ScoredCheck>();
  for (const r of results) if (r.status !== 'ERROR') latest.set(r.type, r);

  let weighted = 0;
  let totalWeight = 0;
  for (const { type, score } of latest.values()) {
    weighted += score * CHECK_WEIGHTS[type];
    totalWeight += CHECK_WEIGHTS[type];
  }
  return totalWeight === 0 ? null : Math.round(weighted / totalWeight);
}

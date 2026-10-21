import { scoreFromFindings, statusFromFindings, type Severity } from '@sitesentinel/shared';
import type { CheckResult, Finding } from '../types.js';

export function finding(
  code: string,
  severity: Severity,
  message: string,
  recommendation: string,
): Finding {
  return { code, severity, message, recommendation };
}

/**
 * The standard result: status from the worst finding, score from severity
 * penalties. `hardFail` scores 0 for problems that break the site outright
 * (expired certificate, site down, plain HTTP), whatever else is fine.
 */
export function resultFrom(
  findings: Finding[],
  raw: Record<string, unknown>,
  { hardFail = false } = {},
): CheckResult {
  return {
    status: statusFromFindings(findings),
    score: hardFail ? 0 : scoreFromFindings(findings),
    findings,
    raw,
  };
}

/** Node DNS error codes that mean "no such record", as opposed to a failed lookup. */
const NO_RECORD_CODES = new Set(['ENODATA', 'ENOTFOUND', 'NXDOMAIN']);

export function isNoRecordError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && NO_RECORD_CODES.has(code);
}

/** TXT lookup where "no records" is an empty list and real failures still throw. */
export async function txtRecords(
  resolveTxt: (hostname: string) => Promise<string[][]>,
  hostname: string,
): Promise<string[]> {
  try {
    // Long TXT values arrive split into 255-byte chunks; rejoin them first.
    return (await resolveTxt(hostname)).map((chunks) => chunks.join('').trim());
  } catch (err) {
    if (isNoRecordError(err)) return [];
    throw err;
  }
}

export const DAY_MS = 24 * 60 * 60 * 1000;

import {
  VERIFICATION_FILE_PATH,
  VERIFICATION_TXT_PREFIX,
  type VerificationAttempt,
  type VerificationMethod,
} from '@sitesentinel/shared';
import { isNoRecordError } from './checks/result.js';
import type { CheckDeps } from './types.js';

export interface OwnershipClaim {
  /** Normalised domain. */
  domain: string;
  token: string;
  /** Only try this method; by default DNS TXT, then the well-known file. */
  method?: VerificationMethod;
}

export interface VerificationResult {
  verified: boolean;
  method: VerificationMethod | null;
  attempts: VerificationAttempt[];
}

export type VerificationDeps = Pick<CheckDeps, 'http' | 'dns'>;

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function viaDnsTxt(
  claim: OwnershipClaim,
  deps: VerificationDeps,
): Promise<VerificationAttempt> {
  const method = 'DNS_TXT';
  const expected = `${VERIFICATION_TXT_PREFIX}${claim.token}`;
  let records: string[][];
  try {
    records = await deps.dns.resolveTxt(claim.domain);
  } catch (err) {
    const detail = isNoRecordError(err)
      ? `No TXT records found on ${claim.domain}.`
      : `DNS lookup for ${claim.domain} failed: ${errorText(err)}`;
    return { method, ok: false, detail };
  }

  // Long TXT values arrive split into 255-byte chunks; rejoin them first.
  const values = records.map((chunks) => chunks.join('').trim());
  if (values.includes(expected)) {
    return { method, ok: true, detail: `Found TXT record ${expected}.` };
  }
  return {
    method,
    ok: false,
    detail: `Found ${values.length} TXT record(s) on ${claim.domain}, but none equal ${expected}. DNS changes can take a few minutes to propagate.`,
  };
}

async function viaWellKnownFile(
  claim: OwnershipClaim,
  deps: VerificationDeps,
): Promise<VerificationAttempt> {
  const method = 'WELL_KNOWN_FILE';
  const url = `https://${claim.domain}${VERIFICATION_FILE_PATH}`;
  try {
    // No redirects: a redirect to another host must not be able to vouch for this domain.
    const res = await deps.http.request({ url, method: 'GET', maxRedirects: 0 });
    if (res.status >= 300 && res.status < 400) {
      return { method, ok: false, detail: `${url} redirects; serve the file directly.` };
    }
    if (res.status !== 200) {
      return { method, ok: false, detail: `${url} returned HTTP ${res.status}.` };
    }
    if (res.body.trim() !== claim.token) {
      return { method, ok: false, detail: `${url} does not contain the expected token.` };
    }
    return { method, ok: true, detail: `Found the token at ${url}.` };
  } catch (err) {
    return { method, ok: false, detail: `Could not fetch ${url}: ${errorText(err)}` };
  }
}

/**
 * Proves the user controls `domain` via a DNS TXT record or a file on the site.
 * Never throws: every failure becomes an attempt with a human-readable detail.
 */
export async function verifyOwnership(
  claim: OwnershipClaim,
  deps: VerificationDeps,
): Promise<VerificationResult> {
  const methods: VerificationMethod[] = claim.method
    ? [claim.method]
    : ['DNS_TXT', 'WELL_KNOWN_FILE'];
  const attempts: VerificationAttempt[] = [];
  for (const method of methods) {
    const attempt =
      method === 'DNS_TXT' ? await viaDnsTxt(claim, deps) : await viaWellKnownFile(claim, deps);
    attempts.push(attempt);
    if (attempt.ok) return { verified: true, method, attempts };
  }
  return { verified: false, method: null, attempts };
}

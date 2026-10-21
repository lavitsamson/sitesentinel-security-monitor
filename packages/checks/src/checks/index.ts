import type { CheckType } from '@sitesentinel/shared';
import { SafeFetchError, errorMessage } from '../net/safe-fetch.js';
import type { Check, CheckDeps, CheckResult, CheckTarget } from '../types.js';
import { emailDnsCheck } from './email-dns.js';
import { httpsRedirectCheck } from './https-redirect.js';
import { finding } from './result.js';
import { securityHeadersCheck } from './security-headers.js';
import { securityTxtCheck } from './security-txt.js';
import { tlsCheck } from './tls.js';
import { uptimeCheck } from './uptime.js';

export const CHECKS: Record<CheckType, Check> = {
  TLS: tlsCheck,
  SECURITY_HEADERS: securityHeadersCheck,
  HTTPS_REDIRECT: httpsRedirectCheck,
  EMAIL_DNS: emailDnsCheck,
  SECURITY_TXT: securityTxtCheck,
  UPTIME: uptimeCheck,
};

/**
 * Runs one check and never throws: anything a check can't handle (a refused
 * address, a resolver outage, a timeout mid-check) becomes an ERROR result,
 * which the overall score ignores.
 */
export async function runCheck(
  type: CheckType,
  target: CheckTarget,
  deps: CheckDeps,
): Promise<CheckResult> {
  try {
    return await CHECKS[type](target, deps);
  } catch (err) {
    const code = err instanceof SafeFetchError ? err.code : 'UNEXPECTED';
    const blocked = code === 'BLOCKED_ADDRESS' || code === 'BLOCKED_URL';
    return {
      status: 'ERROR',
      score: 0,
      findings: [
        finding(
          'CHECK_ERROR',
          'info',
          `The ${type} check could not run: ${errorMessage(err)}`,
          blocked
            ? 'SiteSentinel only connects to public addresses on ports 80 and 443. Make sure the domain resolves to a public IP.'
            : 'This is usually temporary and the check will run again. If it keeps happening, check that the domain resolves and answers on port 443.',
        ),
      ],
      raw: { error: code },
    };
  }
}

export { CERT_EXPIRY_WARNING_DAYS, hostnameMatches } from './tls.js';
export { parseCsp } from './security-headers.js';
export { SPF_MAX_LOOKUPS, countSpfLookups, parseDmarc } from './email-dns.js';
export { SECURITY_TXT_PATH, parseSecurityTxt } from './security-txt.js';
export { DOWN_AFTER_FAILURES, SLOW_RESPONSE_MS, siteStatusFromUptime } from './uptime.js';
export {
  emailDnsCheck,
  httpsRedirectCheck,
  securityHeadersCheck,
  securityTxtCheck,
  tlsCheck,
  uptimeCheck,
};

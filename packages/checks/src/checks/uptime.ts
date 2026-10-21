import type { SiteStatus } from '@sitesentinel/shared';
import { SafeFetchError } from '../net/safe-fetch.js';
import type { Check, CheckResult, HttpResponse } from '../types.js';
import { finding, resultFrom } from './result.js';

/** Responses slower than this mark the site DEGRADED. */
export const SLOW_RESPONSE_MS = 3_000;
/** Consecutive failed uptime checks before a site counts as DOWN. */
export const DOWN_AFTER_FAILURES = 2;

/** Failures that mean "the site didn't answer" rather than "we refused to ask". */
const UNREACHABLE_CODES = new Set(['NETWORK', 'TIMEOUT', 'DNS_FAILURE']);

/**
 * HEAD the homepage (cheap), falling back to GET for servers that answer HEAD
 * with an error. Records whether the site answered, the status and timing.
 * A single failure is a FAIL result; turning results into UP/DOWN/DEGRADED
 * over time is `siteStatusFromUptime`.
 */
export const uptimeCheck: Check = async ({ domain }, { http }) => {
  const url = `https://${domain}/`;
  let res: HttpResponse;
  let method: 'HEAD' | 'GET' = 'HEAD';
  try {
    res = await http.request({ url, method, maxRedirects: 3 });
    if (res.status >= 400) {
      method = 'GET';
      res = await http.request({ url, method, maxRedirects: 3 });
    }
  } catch (err) {
    if (!(err instanceof SafeFetchError) || !UNREACHABLE_CODES.has(err.code)) throw err;
    return resultFrom(
      [
        finding(
          'UPTIME_UNREACHABLE',
          'high',
          `${url} did not respond: ${err.message}`,
          'Check that the server is running, DNS points at it and port 443 is open to the internet.',
        ),
      ],
      { up: false, method, statusCode: null, responseTimeMs: null, error: err.code },
      { hardFail: true },
    );
  }

  const raw = { up: true, method, statusCode: res.status, responseTimeMs: res.durationMs };
  if (res.status >= 500) {
    return resultFrom(
      [
        finding(
          'UPTIME_SERVER_ERROR',
          'high',
          `${url} returned HTTP ${res.status}.`,
          'Check your application and server logs for the cause of the error.',
        ),
      ],
      { ...raw, up: false },
      { hardFail: true },
    );
  }

  const findings = [];
  if (res.status >= 400) {
    findings.push(
      finding(
        'UPTIME_CLIENT_ERROR',
        'medium',
        `${url} answered, but with HTTP ${res.status}.`,
        'Make sure the homepage is publicly reachable and returns 200.',
      ),
    );
  }
  if (res.durationMs > SLOW_RESPONSE_MS) {
    findings.push(
      finding(
        'UPTIME_SLOW',
        'medium',
        `The homepage took ${(res.durationMs / 1000).toFixed(1)} s to respond (over ${SLOW_RESPONSE_MS / 1000} s).`,
        'Look at server load, slow database queries and caching; a CDN can help.',
      ),
    );
  }
  return resultFrom(findings, raw);
};

/**
 * Site status from recent UPTIME results, newest first. ERROR runs (we couldn't
 * check) are skipped. DOWN needs `DOWN_AFTER_FAILURES` failures in a row, so one
 * blip only shows as DEGRADED; slow responses are DEGRADED too.
 */
export function siteStatusFromUptime(recent: readonly CheckResult[]): SiteStatus {
  const runs = recent.filter((r) => r.status !== 'ERROR');
  const [latest] = runs;
  if (!latest) return 'UNKNOWN';
  const isDown = (r: CheckResult) => r.raw.up === false;
  if (isDown(latest)) {
    const streak = runs.slice(0, DOWN_AFTER_FAILURES);
    return streak.length === DOWN_AFTER_FAILURES && streak.every(isDown) ? 'DOWN' : 'DEGRADED';
  }
  return latest.status === 'PASS' ? 'UP' : 'DEGRADED';
}

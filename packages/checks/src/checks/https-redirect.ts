import { SafeFetchError } from '../net/safe-fetch.js';
import type { Check, Finding } from '../types.js';
import { finding, resultFrom } from './result.js';

const PERMANENT = new Set([301, 308]);
const TEMPORARY = new Set([302, 303, 307]);

function resolveLocation(location: string, base: string): URL | null {
  try {
    return new URL(location, base);
  } catch {
    return null;
  }
}

/**
 * GET http://domain/ without following redirects. The first response should be a
 * permanent redirect to https; anything served over plain HTTP fails.
 */
export const httpsRedirectCheck: Check = async ({ domain }, { http }) => {
  const url = `http://${domain}/`;
  let res;
  try {
    res = await http.request({ url, method: 'GET', maxRedirects: 0 });
  } catch (err) {
    // Port 80 refusing connections means nothing is served over plain HTTP.
    if (err instanceof SafeFetchError && err.code === 'NETWORK') {
      return resultFrom(
        [
          finding(
            'HTTPS_REDIRECT_PORT_CLOSED',
            'low',
            `Nothing answers on http://${domain}/, so visitors who type the bare domain may see an error.`,
            `Serve a 301 redirect from http://${domain}/ to https://${domain}/ on port 80.`,
          ),
        ],
        { url, reachable: false },
      );
    }
    throw err;
  }

  const location = res.headers.location;
  const destination = location ? resolveLocation(location, url) : null;
  const raw = { url, statusCode: res.status, location: location ?? null };
  const isRedirect = PERMANENT.has(res.status) || TEMPORARY.has(res.status);

  if (!isRedirect) {
    return resultFrom(
      [
        finding(
          'HTTPS_REDIRECT_MISSING',
          'high',
          `http://${domain}/ answers with HTTP ${res.status} over plain HTTP instead of redirecting to HTTPS.`,
          `Redirect every plain-HTTP request with a 301 to https://${domain}/ (for example "return 301 https://$host$request_uri;" in nginx).`,
        ),
      ],
      raw,
      { hardFail: true },
    );
  }

  const findings: Finding[] = [];
  if (!destination || destination.protocol !== 'https:') {
    findings.push(
      finding(
        'HTTPS_REDIRECT_NOT_HTTPS',
        'medium',
        `http://${domain}/ redirects to ${location ?? 'nowhere (no Location header)'}, which is not HTTPS.`,
        `Redirect straight to https://${domain}/ in a single hop.`,
      ),
    );
  }
  if (TEMPORARY.has(res.status)) {
    findings.push(
      finding(
        'HTTPS_REDIRECT_TEMPORARY',
        'medium',
        `The redirect is temporary (HTTP ${res.status}), so browsers and search engines won't remember it.`,
        'Use a permanent redirect: 301, or 308 to preserve the request method.',
      ),
    );
  }
  return resultFrom(findings, raw);
};

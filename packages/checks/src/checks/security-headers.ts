import {
  CSP_MIN_POINTS,
  CSP_WEAKNESS_PENALTY,
  HSTS_MIN_MAX_AGE,
  SECURITY_HEADER_POINTS as MAX,
  securityHeadersStatus,
  type SecurityHeaderKey,
} from '@sitesentinel/shared';
import type { Check, Finding } from '../types.js';
import { finding } from './result.js';

/** Headers kept as evidence in `raw` (never the whole response). */
const EVIDENCE_HEADERS = [
  'strict-transport-security',
  'content-security-policy',
  'content-security-policy-report-only',
  'x-content-type-options',
  'x-frame-options',
  'referrer-policy',
  'permissions-policy',
  'server',
  'x-powered-by',
];

const WEAK_REFERRER_POLICIES = new Set(['unsafe-url', 'no-referrer-when-downgrade']);
const REFERRER_POLICIES = new Set([
  'no-referrer',
  'no-referrer-when-downgrade',
  'origin',
  'origin-when-cross-origin',
  'same-origin',
  'strict-origin',
  'strict-origin-when-cross-origin',
  'unsafe-url',
]);

/** Parses a CSP into lowercase directive → source list. The first occurrence of a directive wins. */
export function parseCsp(policy: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const part of policy.split(';')) {
    const [name, ...sources] = part.trim().toLowerCase().split(/\s+/);
    if (name && !directives.has(name)) directives.set(name, sources);
  }
  return directives;
}

interface Evaluation {
  points: number;
  findings: Finding[];
}

function evaluateHsts(value: string | undefined): Evaluation {
  const add =
    'Strict-Transport-Security: max-age=31536000; includeSubDomains (add preload once every subdomain serves HTTPS)';
  if (!value) {
    return {
      points: 0,
      findings: [
        finding(
          'HEADERS_HSTS_MISSING',
          'medium',
          'No Strict-Transport-Security header, so browsers may still try plain HTTP first.',
          `Add ${add}.`,
        ),
      ],
    };
  }
  const maxAge = Number(/max-age\s*=\s*"?(\d+)"?/i.exec(value)?.[1] ?? 0);
  if (maxAge === 0) {
    return {
      points: 0,
      findings: [
        finding(
          'HEADERS_HSTS_DISABLED',
          'medium',
          'Strict-Transport-Security is present but max-age is 0 or missing, which turns HSTS off.',
          `Set ${add}.`,
        ),
      ],
    };
  }

  let points = MAX.hsts;
  const findings: Finding[] = [];
  if (maxAge < HSTS_MIN_MAX_AGE) {
    points = MAX.hsts / 2;
    findings.push(
      finding(
        'HEADERS_HSTS_SHORT_MAX_AGE',
        'low',
        `HSTS max-age is ${maxAge} seconds; at least ${HSTS_MIN_MAX_AGE} (180 days) is recommended.`,
        'Raise max-age to 31536000 (one year) once you are confident HTTPS works everywhere.',
      ),
    );
  }
  if (!/includesubdomains/i.test(value)) {
    points -= 5;
    findings.push(
      finding(
        'HEADERS_HSTS_NO_SUBDOMAINS',
        'low',
        'HSTS does not include subdomains, so they can still be reached over plain HTTP.',
        'Add includeSubDomains to the Strict-Transport-Security header.',
      ),
    );
  }
  return { points, findings };
}

function evaluateCsp(
  csp: Map<string, string[]> | null,
  reportOnly: string | undefined,
): Evaluation {
  if (!csp) {
    const findings = [
      finding(
        'HEADERS_CSP_MISSING',
        'medium',
        'No Content-Security-Policy header, so injected scripts run unrestricted.',
        "Add a Content-Security-Policy, starting from default-src 'self' and allowing only the origins you use. Roll it out with Content-Security-Policy-Report-Only first.",
      ),
    ];
    if (reportOnly) {
      findings.push(
        finding(
          'HEADERS_CSP_REPORT_ONLY',
          'info',
          'A Content-Security-Policy-Report-Only header is present, which reports but does not block.',
          'Once the reports are clean, send the same policy as Content-Security-Policy to enforce it.',
        ),
      );
    }
    return { points: 0, findings };
  }

  // Scripts are what matter for XSS: script-src, falling back to default-src.
  const scriptSources = csp.get('script-src') ?? csp.get('default-src') ?? [];
  // With a nonce or hash, CSP2+ browsers ignore 'unsafe-inline'.
  const hasNonceOrHash = scriptSources.some((s) => /^'(nonce|sha256|sha384|sha512)-/.test(s));
  const weaknesses: Finding[] = [];
  if (scriptSources.includes("'unsafe-inline'") && !hasNonceOrHash) {
    weaknesses.push(
      finding(
        'HEADERS_CSP_UNSAFE_INLINE',
        'low',
        "The Content-Security-Policy allows 'unsafe-inline' scripts, which defeats most XSS protection.",
        "Move inline scripts into files, or use nonces or hashes, then remove 'unsafe-inline' from script-src.",
      ),
    );
  }
  if (scriptSources.includes("'unsafe-eval'")) {
    weaknesses.push(
      finding(
        'HEADERS_CSP_UNSAFE_EVAL',
        'low',
        "The Content-Security-Policy allows 'unsafe-eval'.",
        "Remove 'unsafe-eval' from script-src and replace eval()/new Function() usage.",
      ),
    );
  }
  if (scriptSources.some((s) => s === '*' || s === 'https:' || s === 'http:' || s === 'data:')) {
    weaknesses.push(
      finding(
        'HEADERS_CSP_WILDCARD',
        'low',
        'The Content-Security-Policy allows scripts from any origin (a wildcard or bare scheme source).',
        'Replace *, https:, http: or data: in script-src with the specific origins you load scripts from.',
      ),
    );
  }
  const points = Math.max(CSP_MIN_POINTS, MAX.csp - weaknesses.length * CSP_WEAKNESS_PENALTY);
  return { points, findings: weaknesses };
}

function evaluateClickjacking(
  csp: Map<string, string[]> | null,
  xFrameOptions: string | undefined,
): Evaluation {
  const xfo = xFrameOptions?.trim().toLowerCase();
  if (csp?.has('frame-ancestors') || xfo === 'deny' || xfo === 'sameorigin') {
    return { points: MAX.clickjacking, findings: [] };
  }
  return {
    points: 0,
    findings: [
      finding(
        'HEADERS_CLICKJACKING_MISSING',
        'medium',
        'Nothing stops other sites from framing this page (clickjacking).',
        "Add frame-ancestors 'self' to your Content-Security-Policy, or X-Frame-Options: DENY.",
      ),
    ],
  };
}

function evaluateReferrerPolicy(value: string | undefined): Evaluation {
  // A comma-separated list is allowed; browsers use the last value they understand.
  const policy = value
    ?.split(',')
    .map((p) => p.trim().toLowerCase())
    .filter((p) => REFERRER_POLICIES.has(p))
    .at(-1);
  if (!policy) {
    return {
      points: 0,
      findings: [
        finding(
          'HEADERS_REFERRER_POLICY_MISSING',
          'low',
          'No valid Referrer-Policy header.',
          'Add Referrer-Policy: strict-origin-when-cross-origin.',
        ),
      ],
    };
  }
  if (WEAK_REFERRER_POLICIES.has(policy)) {
    return {
      points: MAX.referrerPolicy / 2,
      findings: [
        finding(
          'HEADERS_REFERRER_POLICY_WEAK',
          'low',
          `Referrer-Policy is ${policy}, which sends full URLs (paths and query strings) to other sites.`,
          'Use Referrer-Policy: strict-origin-when-cross-origin.',
        ),
      ],
    };
  }
  return { points: MAX.referrerPolicy, findings: [] };
}

function evaluateVersionLeak(headers: Record<string, string>): Evaluation {
  const leaky = (['server', 'x-powered-by'] as const).filter((name) =>
    /\d+\.\d+/.test(headers[name] ?? ''),
  );
  if (leaky.length === 0) return { points: MAX.noVersionLeak, findings: [] };
  const shown = leaky.map((name) => `${name}: ${headers[name]}`).join('; ');
  return {
    points: 0,
    findings: [
      finding(
        'HEADERS_VERSION_DISCLOSURE',
        'low',
        `Response headers reveal software versions (${shown}), which helps attackers pick exploits.`,
        'Remove X-Powered-By and strip version numbers from Server (for example server_tokens off in nginx, ServerTokens Prod in Apache).',
      ),
    ],
  };
}

export const securityHeadersCheck: Check = async ({ domain }, { http }) => {
  const res = await http.request({ url: `https://${domain}/`, method: 'GET', maxRedirects: 3 });
  const h = res.headers;
  const cspHeader = h['content-security-policy'];
  const csp = cspHeader ? parseCsp(cspHeader) : null;

  const evaluations: Record<SecurityHeaderKey, Evaluation> = {
    hsts: evaluateHsts(h['strict-transport-security']),
    csp: evaluateCsp(csp, h['content-security-policy-report-only']),
    contentTypeOptions:
      h['x-content-type-options']?.trim().toLowerCase() === 'nosniff'
        ? { points: MAX.contentTypeOptions, findings: [] }
        : {
            points: 0,
            findings: [
              finding(
                'HEADERS_XCTO_MISSING',
                'low',
                'X-Content-Type-Options: nosniff is missing, so browsers may guess (sniff) content types.',
                'Add X-Content-Type-Options: nosniff.',
              ),
            ],
          },
    clickjacking: evaluateClickjacking(csp, h['x-frame-options']),
    referrerPolicy: evaluateReferrerPolicy(h['referrer-policy']),
    permissionsPolicy: h['permissions-policy']
      ? { points: MAX.permissionsPolicy, findings: [] }
      : {
          points: 0,
          findings: [
            finding(
              'HEADERS_PERMISSIONS_POLICY_MISSING',
              'low',
              'No Permissions-Policy header to limit powerful browser features.',
              'Add a Permissions-Policy that disables what you do not use, for example: camera=(), microphone=(), geolocation=().',
            ),
          ],
        },
    noVersionLeak: evaluateVersionLeak(h),
  };

  const entries = Object.entries(evaluations) as [SecurityHeaderKey, Evaluation][];
  const score = Math.round(entries.reduce((sum, [, e]) => sum + e.points, 0));
  const evidence = Object.fromEntries(
    EVIDENCE_HEADERS.filter((name) => h[name] !== undefined).map((name) => [name, h[name]]),
  );

  return {
    status: securityHeadersStatus(score),
    score,
    findings: entries.flatMap(([, e]) => e.findings),
    raw: {
      url: res.url,
      statusCode: res.status,
      headers: evidence,
      points: Object.fromEntries(entries.map(([key, e]) => [key, e.points])),
    },
  };
};

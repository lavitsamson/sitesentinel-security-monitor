import { SECURITY_HEADER_POINTS } from '@sitesentinel/shared';
import { fakeDeps, fakeHttp, target } from '../test/fakes.js';
import { parseCsp, securityHeadersCheck } from './security-headers.js';

const PERFECT = {
  'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
  'content-security-policy': "default-src 'self'; script-src 'self'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=()',
  server: 'nginx',
};

const run = (headers: Record<string, string>) => {
  const http = fakeHttp({ 'GET https://example.com/': { headers, url: 'https://example.com/' } });
  return securityHeadersCheck(target, fakeDeps({ http }));
};

const codes = (findings: { code: string }[]) => findings.map((f) => f.code);

/** Perfect headers with some replaced or (with `undefined`) removed. */
function perfectWith(changes: Record<string, string | undefined>): Record<string, string> {
  const headers: Record<string, string | undefined> = { ...PERFECT, ...changes };
  return Object.fromEntries(
    Object.entries(headers).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

describe('securityHeadersCheck', () => {
  it('scores perfect headers 100 with no findings', async () => {
    const result = await run(PERFECT);

    expect(result).toMatchObject({ status: 'PASS', score: 100, findings: [] });
    expect(result.raw).toMatchObject({
      url: 'https://example.com/',
      statusCode: 200,
      points: SECURITY_HEADER_POINTS,
    });
  });

  it('requests the homepage once, following at most 3 redirects', async () => {
    const http = fakeHttp({ 'GET https://example.com/': { headers: PERFECT } });

    await securityHeadersCheck(target, fakeDeps({ http }));

    expect(http.calls).toEqual([{ url: 'https://example.com/', method: 'GET', maxRedirects: 3 }]);
  });

  it('fails a site with no security headers at all', async () => {
    const result = await run({ server: 'Apache/2.4.41 (Ubuntu)', 'x-powered-by': 'PHP/7.4.3' });

    expect(result.status).toBe('FAIL');
    expect(result.score).toBe(0);
    expect(codes(result.findings)).toEqual([
      'HEADERS_HSTS_MISSING',
      'HEADERS_CSP_MISSING',
      'HEADERS_XCTO_MISSING',
      'HEADERS_CLICKJACKING_MISSING',
      'HEADERS_REFERRER_POLICY_MISSING',
      'HEADERS_PERMISSIONS_POLICY_MISSING',
      'HEADERS_VERSION_DISCLOSURE',
    ]);
    expect(result.raw.headers).toEqual({
      server: 'Apache/2.4.41 (Ubuntu)',
      'x-powered-by': 'PHP/7.4.3',
    });
    const leak = result.findings.at(-1);
    expect(leak?.message).toContain('Apache/2.4.41');
    expect(leak?.message).toContain('PHP/7.4.3');
  });

  it('every finding comes with a recommendation', async () => {
    const result = await run({});

    for (const f of result.findings) expect(f.recommendation.length).toBeGreaterThan(10);
  });

  describe('Strict-Transport-Security', () => {
    it('gives half points for a short max-age', async () => {
      const result = await run(
        perfectWith({ 'strict-transport-security': 'max-age=86400; includeSubDomains' }),
      );

      expect(codes(result.findings)).toEqual(['HEADERS_HSTS_SHORT_MAX_AGE']);
      expect(result.score).toBe(88); // 100 - 12.5, rounded
    });

    it('takes 5 points without includeSubDomains', async () => {
      const result = await run(perfectWith({ 'strict-transport-security': 'max-age=31536000' }));

      expect(codes(result.findings)).toEqual(['HEADERS_HSTS_NO_SUBDOMAINS']);
      expect(result.score).toBe(95);
    });

    it('accepts exactly the minimum max-age', async () => {
      const result = await run(
        perfectWith({ 'strict-transport-security': 'max-age="15552000"; includesubdomains' }),
      );

      expect(result.findings).toEqual([]);
    });

    it('treats max-age=0 as HSTS turned off', async () => {
      const result = await run(perfectWith({ 'strict-transport-security': 'max-age=0' }));

      expect(codes(result.findings)).toEqual(['HEADERS_HSTS_DISABLED']);
      expect(result.score).toBe(75);
      expect(result.status).toBe('WARN');
    });
  });

  describe('Content-Security-Policy', () => {
    it("flags 'unsafe-inline', 'unsafe-eval' and wildcards in script sources", async () => {
      const result = await run(
        perfectWith({
          'content-security-policy':
            "default-src * 'unsafe-inline' 'unsafe-eval'; frame-ancestors 'self'",
        }),
      );

      expect(codes(result.findings)).toEqual([
        'HEADERS_CSP_UNSAFE_INLINE',
        'HEADERS_CSP_UNSAFE_EVAL',
        'HEADERS_CSP_WILDCARD',
      ]);
      // 25 - 3 × 8 = 1, floored at 5 points while a policy is present.
      expect(result.raw.points).toMatchObject({ csp: 5 });
      expect(result.score).toBe(80);
    });

    it('takes 8 points per weakness', async () => {
      const result = await run(
        perfectWith({
          'content-security-policy': "script-src 'self' 'unsafe-eval'; frame-ancestors 'self'",
        }),
      );

      expect(result.score).toBe(92);
    });

    it('never drops below 5 points while a policy is present', async () => {
      const result = await run(
        perfectWith({
          'content-security-policy':
            "script-src https: 'unsafe-inline' 'unsafe-eval'; frame-ancestors 'self'",
          'x-content-type-options': undefined,
        }),
      );

      expect(result.raw.points).toMatchObject({ csp: 5, contentTypeOptions: 0 });
      expect(result.score).toBe(70);
    });

    it("ignores 'unsafe-inline' when a nonce or hash is present (CSP2+)", async () => {
      const result = await run(
        perfectWith({
          'content-security-policy':
            "script-src 'self' 'nonce-abc123' 'unsafe-inline'; frame-ancestors 'none'",
        }),
      );

      expect(result.findings).toEqual([]);
    });

    it('prefers script-src over default-src', async () => {
      const result = await run(
        perfectWith({
          'content-security-policy': "default-src *; script-src 'self'; frame-ancestors 'none'",
        }),
      );

      expect(result.findings).toEqual([]);
    });

    it('notes a report-only policy, which does not enforce anything', async () => {
      const result = await run(
        perfectWith({
          'content-security-policy': undefined,
          'content-security-policy-report-only': "default-src 'self'",
          'x-frame-options': 'DENY',
        }),
      );

      expect(codes(result.findings)).toEqual(['HEADERS_CSP_MISSING', 'HEADERS_CSP_REPORT_ONLY']);
      expect(result.score).toBe(75);
    });
  });

  describe('clickjacking', () => {
    it.each(['DENY', 'sameorigin'])('accepts X-Frame-Options: %s', async (xfo) => {
      const result = await run(
        perfectWith({ 'content-security-policy': "default-src 'self'", 'x-frame-options': xfo }),
      );

      expect(result.findings).toEqual([]);
    });

    it('rejects the obsolete ALLOW-FROM', async () => {
      const result = await run(
        perfectWith({
          'content-security-policy': "default-src 'self'",
          'x-frame-options': 'ALLOW-FROM https://a.example',
        }),
      );

      expect(codes(result.findings)).toEqual(['HEADERS_CLICKJACKING_MISSING']);
    });
  });

  describe('Referrer-Policy', () => {
    it.each(['unsafe-url', 'no-referrer-when-downgrade'])('gives half points for %s', async (p) => {
      const result = await run(perfectWith({ 'referrer-policy': p }));

      expect(codes(result.findings)).toEqual(['HEADERS_REFERRER_POLICY_WEAK']);
      expect(result.score).toBe(95);
    });

    it('uses the last value it understands from a list', async () => {
      const result = await run(
        perfectWith({ 'referrer-policy': 'unsafe-url, no-referrer, bogus' }),
      );

      expect(result.findings).toEqual([]);
    });

    it('treats an unrecognised value as missing', async () => {
      const result = await run(perfectWith({ 'referrer-policy': 'whatever' }));

      expect(codes(result.findings)).toEqual(['HEADERS_REFERRER_POLICY_MISSING']);
    });
  });

  it('accepts a Server header without a version', async () => {
    const result = await run(perfectWith({ server: 'cloudflare', 'x-powered-by': 'Next.js' }));

    expect(result.findings).toEqual([]);
  });

  it('warns between 50 and 79 points', async () => {
    const result = await run(perfectWith({ 'content-security-policy': undefined }));

    // CSP (25) and clickjacking via frame-ancestors (15) both lost.
    expect(result).toMatchObject({ score: 60, status: 'WARN' });
  });
});

describe('parseCsp', () => {
  it('lowercases directives and keeps the first occurrence', () => {
    const csp = parseCsp("Script-Src 'self' https://cdn.example; script-src *;; img-src data:");

    expect(csp.get('script-src')).toEqual(["'self'", 'https://cdn.example']);
    expect(csp.get('img-src')).toEqual(['data:']);
    expect(csp.size).toBe(2);
  });
});

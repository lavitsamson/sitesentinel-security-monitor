import { jest } from '@jest/globals';
import type { DnsResolver, HttpClient, HttpResponse } from './types.js';
import { verifyOwnership, type VerificationDeps } from './verification.js';

const TOKEN = 'tok_abc123';
const claim = { domain: 'example.com', token: TOKEN };
const FILE_URL = 'https://example.com/.well-known/sitesentinel-verify.txt';

function dnsAnswering(records: string[][] | Error): DnsResolver {
  return {
    resolveTxt: jest.fn<DnsResolver['resolveTxt']>(async () => {
      if (records instanceof Error) throw records;
      return records;
    }),
    resolveMx: async () => [],
  };
}

function httpAnswering(res: Partial<HttpResponse> | Error): HttpClient {
  return {
    request: jest.fn<HttpClient['request']>(async (req) => {
      if (res instanceof Error) throw res;
      return { status: 200, headers: {}, body: '', url: req.url, durationMs: 1, ...res };
    }),
  };
}

function dnsError(code: string): Error {
  return Object.assign(new Error(`queryTxt ${code} example.com`), { code });
}

function deps(dns: DnsResolver, http: HttpClient = httpAnswering({ status: 404 })) {
  return { dns, http } satisfies VerificationDeps;
}

describe('verifyOwnership via DNS TXT', () => {
  it('verifies when a TXT record matches', async () => {
    const d = deps(dnsAnswering([['v=spf1 -all'], [`sitesentinel-verify=${TOKEN}`]]));

    const result = await verifyOwnership({ ...claim, method: 'DNS_TXT' }, d);

    expect(result).toMatchObject({ verified: true, method: 'DNS_TXT' });
    expect(d.http.request).not.toHaveBeenCalled();
  });

  it('joins TXT chunks before comparing', async () => {
    const d = deps(dnsAnswering([['sitesentinel-verify=', TOKEN]]));

    await expect(verifyOwnership({ ...claim, method: 'DNS_TXT' }, d)).resolves.toMatchObject({
      verified: true,
    });
  });

  it('explains a mismatch', async () => {
    const d = deps(dnsAnswering([['sitesentinel-verify=wrong']]));

    const result = await verifyOwnership({ ...claim, method: 'DNS_TXT' }, d);

    expect(result.verified).toBe(false);
    expect(result.attempts[0]?.detail).toContain(`none equal sitesentinel-verify=${TOKEN}`);
  });

  it.each(['ENODATA', 'ENOTFOUND'])('reports %s as "no records"', async (code) => {
    const result = await verifyOwnership(
      { ...claim, method: 'DNS_TXT' },
      deps(dnsAnswering(dnsError(code))),
    );

    expect(result.attempts[0]?.detail).toBe('No TXT records found on example.com.');
  });

  it('reports other DNS failures', async () => {
    const result = await verifyOwnership(
      { ...claim, method: 'DNS_TXT' },
      deps(dnsAnswering(dnsError('ETIMEOUT'))),
    );

    expect(result.attempts[0]?.detail).toMatch(/DNS lookup for example.com failed/);
  });
});

describe('verifyOwnership via the well-known file', () => {
  it('verifies when the file contains the token (whitespace trimmed)', async () => {
    const http = httpAnswering({ body: `${TOKEN}\n` });

    const result = await verifyOwnership(
      { ...claim, method: 'WELL_KNOWN_FILE' },
      deps(dnsAnswering([]), http),
    );

    expect(result).toMatchObject({ verified: true, method: 'WELL_KNOWN_FILE' });
    expect(http.request).toHaveBeenCalledWith({ url: FILE_URL, method: 'GET', maxRedirects: 0 });
  });

  it.each([
    [{ status: 404 }, 'returned HTTP 404'],
    [{ status: 301, headers: { location: 'https://other.example/' } }, 'redirects'],
    [{ status: 200, body: 'something else' }, 'does not contain the expected token'],
    [
      new Error('example.com resolves to 10.0.0.1, which is not a public address'),
      'Could not fetch',
    ],
  ])('fails on %j', async (res, detail) => {
    const result = await verifyOwnership(
      { ...claim, method: 'WELL_KNOWN_FILE' },
      deps(dnsAnswering([]), httpAnswering(res)),
    );

    expect(result.verified).toBe(false);
    expect(result.attempts[0]?.detail).toContain(detail);
  });
});

describe('verifyOwnership without a method', () => {
  it('tries DNS first and stops when it succeeds', async () => {
    const d = deps(dnsAnswering([[`sitesentinel-verify=${TOKEN}`]]));

    const result = await verifyOwnership(claim, d);

    expect(result.attempts).toHaveLength(1);
    expect(d.http.request).not.toHaveBeenCalled();
  });

  it('falls back to the file', async () => {
    const result = await verifyOwnership(
      claim,
      deps(dnsAnswering(dnsError('ENODATA')), httpAnswering({ body: TOKEN })),
    );

    expect(result).toMatchObject({ verified: true, method: 'WELL_KNOWN_FILE' });
    expect(result.attempts.map((a) => a.ok)).toEqual([false, true]);
  });

  it('reports both failures', async () => {
    const result = await verifyOwnership(claim, deps(dnsAnswering([])));

    expect(result).toMatchObject({ verified: false, method: null });
    expect(result.attempts.map((a) => a.method)).toEqual(['DNS_TXT', 'WELL_KNOWN_FILE']);
  });
});

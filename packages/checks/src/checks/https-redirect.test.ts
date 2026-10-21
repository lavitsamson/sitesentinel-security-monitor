import { SafeFetchError } from '../net/safe-fetch.js';
import { fakeDeps, fakeHttp, target } from '../test/fakes.js';
import { httpsRedirectCheck } from './https-redirect.js';

const run = (reply: Parameters<typeof fakeHttp>[0][string]) => {
  const http = fakeHttp({ 'GET http://example.com/': reply });
  return httpsRedirectCheck(target, fakeDeps({ http }));
};

const codes = (findings: { code: string }[]) => findings.map((f) => f.code);

describe('httpsRedirectCheck', () => {
  it.each([301, 308])('passes a %d redirect to https', async (status) => {
    const result = await run({ status, headers: { location: 'https://example.com/' } });

    expect(result).toMatchObject({ status: 'PASS', score: 100, findings: [] });
    expect(result.raw).toEqual({
      url: 'http://example.com/',
      statusCode: status,
      location: 'https://example.com/',
    });
  });

  it('does not follow the redirect', async () => {
    const http = fakeHttp({
      'GET http://example.com/': { status: 301, headers: { location: 'https://example.com/' } },
    });

    await httpsRedirectCheck(target, fakeDeps({ http }));

    expect(http.calls).toEqual([{ url: 'http://example.com/', method: 'GET', maxRedirects: 0 }]);
  });

  it('fails a site served over plain HTTP with score 0', async () => {
    const result = await run({ status: 200, body: '<html>' });

    expect(result).toMatchObject({ status: 'FAIL', score: 0 });
    expect(codes(result.findings)).toEqual(['HTTPS_REDIRECT_MISSING']);
  });

  it.each([302, 303, 307])('warns about a temporary %d redirect', async (status) => {
    const result = await run({ status, headers: { location: 'https://example.com/' } });

    expect(result.status).toBe('WARN');
    expect(codes(result.findings)).toEqual(['HTTPS_REDIRECT_TEMPORARY']);
  });

  it('warns when the first hop stays on HTTP', async () => {
    const result = await run({ status: 301, headers: { location: 'http://www.example.com/' } });

    expect(result.status).toBe('WARN');
    expect(codes(result.findings)).toEqual(['HTTPS_REDIRECT_NOT_HTTPS']);
  });

  it('resolves relative locations, which stay on HTTP', async () => {
    const result = await run({ status: 301, headers: { location: '/home' } });

    expect(codes(result.findings)).toEqual(['HTTPS_REDIRECT_NOT_HTTPS']);
  });

  it('warns about a redirect without a usable Location', async () => {
    const missing = await run({ status: 301 });
    const garbage = await run({ status: 308, headers: { location: 'http://[bad' } });

    expect(codes(missing.findings)).toEqual(['HTTPS_REDIRECT_NOT_HTTPS']);
    expect(missing.findings[0]?.message).toContain('no Location header');
    expect(codes(garbage.findings)).toEqual(['HTTPS_REDIRECT_NOT_HTTPS']);
  });

  it('treats a closed port 80 as advice, not a failure', async () => {
    const result = await run(new SafeFetchError('NETWORK', 'connect ECONNREFUSED'));

    expect(result).toMatchObject({ status: 'PASS', score: 90 });
    expect(codes(result.findings)).toEqual(['HTTPS_REDIRECT_PORT_CLOSED']);
  });

  it('rethrows other failures so the run is recorded as ERROR', async () => {
    await expect(run(new SafeFetchError('TIMEOUT', 'slow'))).rejects.toThrow('slow');
  });
});

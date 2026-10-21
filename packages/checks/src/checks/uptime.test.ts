import { SafeFetchError } from '../net/safe-fetch.js';
import { fakeDeps, fakeHttp, target } from '../test/fakes.js';
import type { CheckResult } from '../types.js';
import { siteStatusFromUptime, uptimeCheck } from './uptime.js';

const HOME = 'https://example.com/';
const run = (replies: Parameters<typeof fakeHttp>[0]) => {
  const http = fakeHttp(replies);
  return { http, result: uptimeCheck(target, fakeDeps({ http })) };
};

const codes = (findings: { code: string }[]) => findings.map((f) => f.code);

describe('uptimeCheck', () => {
  it('passes a fast HEAD response', async () => {
    const { http, result } = run({ [`HEAD ${HOME}`]: { status: 200, durationMs: 180 } });

    expect(await result).toMatchObject({
      status: 'PASS',
      score: 100,
      raw: { up: true, method: 'HEAD', statusCode: 200, responseTimeMs: 180 },
    });
    expect(http.calls).toHaveLength(1);
  });

  it('falls back to GET when HEAD is answered with an error', async () => {
    const { http, result } = run({
      [`HEAD ${HOME}`]: { status: 405 },
      [`GET ${HOME}`]: { status: 200, durationMs: 250 },
    });

    expect(await result).toMatchObject({ status: 'PASS', raw: { method: 'GET', statusCode: 200 } });
    expect(http.calls.map((c) => c.method)).toEqual(['HEAD', 'GET']);
  });

  it('warns about responses slower than 3 s', async () => {
    const { result } = run({ [`HEAD ${HOME}`]: { status: 200, durationMs: 3_400 } });

    const r = await result;
    expect(r.status).toBe('WARN');
    expect(codes(r.findings)).toEqual(['UPTIME_SLOW']);
    expect(r.findings[0]?.message).toContain('3.4 s');
  });

  it('does not warn at exactly 3 s', async () => {
    const { result } = run({ [`HEAD ${HOME}`]: { status: 200, durationMs: 3_000 } });

    expect((await result).status).toBe('PASS');
  });

  it('warns when the homepage answers with a 4xx even over GET', async () => {
    const { result } = run({ [`HEAD ${HOME}`]: { status: 404 }, [`GET ${HOME}`]: { status: 404 } });

    const r = await result;
    expect(r).toMatchObject({ status: 'WARN', raw: { up: true, statusCode: 404 } });
    expect(codes(r.findings)).toEqual(['UPTIME_CLIENT_ERROR']);
  });

  it('fails a 5xx as down', async () => {
    const { result } = run({ [`HEAD ${HOME}`]: { status: 503 }, [`GET ${HOME}`]: { status: 502 } });

    const r = await result;
    expect(r).toMatchObject({ status: 'FAIL', score: 0, raw: { up: false, statusCode: 502 } });
    expect(codes(r.findings)).toEqual(['UPTIME_SERVER_ERROR']);
  });

  it.each(['NETWORK', 'TIMEOUT', 'DNS_FAILURE'] as const)(
    'fails as down when the request ends in %s',
    async (code) => {
      const { result } = run({ [`HEAD ${HOME}`]: new SafeFetchError(code, 'nope') });

      const r = await result;
      expect(r).toMatchObject({ status: 'FAIL', score: 0, raw: { up: false, error: code } });
      expect(codes(r.findings)).toEqual(['UPTIME_UNREACHABLE']);
    },
  );

  it('rethrows a refused address rather than calling the site down', async () => {
    const { result } = run({ [`HEAD ${HOME}`]: new SafeFetchError('BLOCKED_ADDRESS', 'private') });

    await expect(result).rejects.toThrow('private');
  });
});

describe('siteStatusFromUptime', () => {
  const up = (status: CheckResult['status'] = 'PASS'): CheckResult => ({
    status,
    score: 100,
    findings: [],
    raw: { up: true },
  });
  const down = (): CheckResult => ({ status: 'FAIL', score: 0, findings: [], raw: { up: false } });
  const error = (): CheckResult => ({ status: 'ERROR', score: 0, findings: [], raw: {} });

  it.each([
    ['no runs', [], 'UNKNOWN'],
    ['only errors', [error()], 'UNKNOWN'],
    ['a healthy run', [up()], 'UP'],
    ['a slow run', [up('WARN'), up()], 'DEGRADED'],
    ['one failure', [down(), up()], 'DEGRADED'],
    ['a single failure with no history', [down()], 'DEGRADED'],
    ['two failures in a row', [down(), down(), up()], 'DOWN'],
    ['two failures with an error between them', [down(), error(), down()], 'DOWN'],
    ['recovery after an outage', [up(), down(), down()], 'UP'],
  ] as const)('%s → %s', (_, runs, expected) => {
    expect(siteStatusFromUptime(runs)).toBe(expected);
  });
});

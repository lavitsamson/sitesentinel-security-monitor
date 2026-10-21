import { CHECK_TYPES } from '@sitesentinel/shared';
import { SafeFetchError } from '../net/safe-fetch.js';
import { fakeDeps, fakeHttp, target } from '../test/fakes.js';
import { CHECKS, runCheck } from './index.js';

describe('CHECKS', () => {
  it('has an implementation for every check type', () => {
    expect(Object.keys(CHECKS).sort()).toEqual([...CHECK_TYPES].sort());
  });
});

describe('runCheck', () => {
  it('returns the check result when it succeeds', async () => {
    const http = fakeHttp({
      'GET http://example.com/': { status: 301, headers: { location: 'https://example.com/' } },
    });

    const result = await runCheck('HTTPS_REDIRECT', target, fakeDeps({ http }));

    expect(result.status).toBe('PASS');
  });

  it('turns a refused address into an ERROR result with guidance', async () => {
    const http = fakeHttp({
      'HEAD https://example.com/': new SafeFetchError(
        'BLOCKED_ADDRESS',
        'example.com resolves to 10.0.0.1',
      ),
    });

    const result = await runCheck('UPTIME', target, fakeDeps({ http }));

    expect(result).toMatchObject({ status: 'ERROR', score: 0, raw: { error: 'BLOCKED_ADDRESS' } });
    expect(result.findings[0]).toMatchObject({ code: 'CHECK_ERROR', severity: 'info' });
    expect(result.findings[0]?.message).toContain('10.0.0.1');
    expect(result.findings[0]?.recommendation).toContain('public');
  });

  it('turns unexpected errors into an ERROR result', async () => {
    const result = await runCheck('TLS', target, fakeDeps());

    expect(result).toMatchObject({ status: 'ERROR', raw: { error: 'UNEXPECTED' } });
    expect(result.findings[0]?.recommendation).toContain('temporary');
  });
});

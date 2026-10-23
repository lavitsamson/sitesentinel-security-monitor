import { checkReadiness } from './readiness.js';

describe('checkReadiness', () => {
  it('is ok when every probe resolves', async () => {
    const report = await checkReadiness({ a: async () => 1, b: async () => 'PONG' }, 100);

    expect(report.status).toBe('ok');
    expect(report.checks.a).toEqual({ status: 'up', latencyMs: expect.any(Number) });
  });

  it('reports each failing or hanging probe with its reason', async () => {
    const report = await checkReadiness(
      {
        up: async () => undefined,
        broken: async () => {
          throw new Error('not connected');
        },
        hung: () => new Promise(() => {}),
        sync: () => {
          throw 'boom';
        },
      },
      50,
    );

    expect(report.status).toBe('error');
    expect(report.checks.up?.status).toBe('up');
    expect(report.checks.broken).toMatchObject({ status: 'down', error: 'not connected' });
    expect(report.checks.hung).toMatchObject({ status: 'down', error: 'timed out after 50 ms' });
    expect(report.checks.sync).toMatchObject({ status: 'down', error: 'boom' });
  });

  it('is ok with no dependencies', async () => {
    expect(await checkReadiness({}, 50)).toEqual({ status: 'ok', checks: {} });
  });
});

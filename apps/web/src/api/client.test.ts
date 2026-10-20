import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, fetchReadiness } from './client';

function respond(status: number, body: unknown, contentType = 'application/json') {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), { status, headers: { 'content-type': contentType } }),
    ),
  );
}

describe('fetchReadiness', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the report on 200', async () => {
    respond(200, { status: 'ok', checks: { mongo: { status: 'up', latencyMs: 2 } } });

    await expect(fetchReadiness()).resolves.toEqual({
      status: 'ok',
      checks: { mongo: { status: 'up', latencyMs: 2 } },
    });
  });

  it('treats 503 as a valid degraded report', async () => {
    respond(503, {
      status: 'error',
      checks: { redis: { status: 'down', latencyMs: 9, error: 'x' } },
    });

    await expect(fetchReadiness()).resolves.toMatchObject({ status: 'error' });
  });

  it('throws ApiError with Problem Details on other failures', async () => {
    respond(
      500,
      { type: 'about:blank', title: 'Internal Server Error', status: 500 },
      'application/problem+json',
    );

    const error = await fetchReadiness().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 500, message: 'Internal Server Error' });
  });

  it('sends credentials so auth cookies are included', async () => {
    respond(200, { status: 'ok', checks: {} });

    await fetchReadiness();

    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/health/ready',
      expect.objectContaining({ credentials: 'include' }),
    );
  });
});

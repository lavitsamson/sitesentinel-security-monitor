import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError, apiRequest, fetchReadiness, onSessionExpired } from './client';

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

describe('apiRequest', () => {
  type Reply = { status: number; body?: unknown; contentType?: string };
  const reply = ({ status, body, contentType = 'application/json' }: Reply) =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': contentType },
    });

  /** Answers /auth/refresh with `refreshStatus` and every other call from `replies` in order. */
  function stubFetch(replies: Reply[], refreshStatus = 204) {
    const queue = [...replies];
    const mock = vi.fn(async (url: string) =>
      url.endsWith('/auth/refresh') ? reply({ status: refreshStatus }) : reply(queue.shift()!),
    );
    vi.stubGlobal('fetch', mock);
    return mock;
  }
  const refreshCalls = (mock: ReturnType<typeof stubFetch>) =>
    mock.mock.calls.filter(([url]) => String(url).endsWith('/auth/refresh')).length;
  const user = { id: '1' };
  const schema = z.object({ id: z.string() });

  afterEach(() => {
    vi.unstubAllGlobals();
    onSessionExpired(undefined);
  });

  it('sends JSON with the CSRF header on mutations, but not on reads', async () => {
    const mock = stubFetch([
      { status: 200, body: user },
      { status: 200, body: user },
    ]);

    await apiRequest('POST', '/things', { body: { a: 1 }, schema });
    await apiRequest('GET', '/things', { schema });

    const [[, post], [, get]] = mock.mock.calls as unknown as [
      [string, RequestInit],
      [string, RequestInit],
    ];
    expect(post.headers).toMatchObject({
      'content-type': 'application/json',
      'x-requested-with': 'XMLHttpRequest',
    });
    expect(post.body).toBe('{"a":1}');
    expect(get.headers).not.toHaveProperty('x-requested-with');
    expect(get.credentials).toBe('include');
  });

  it('refreshes the session once on 401 and retries', async () => {
    const mock = stubFetch([{ status: 401 }, { status: 200, body: user }]);

    await expect(apiRequest('GET', '/auth/me', { schema })).resolves.toEqual(user);
    expect(refreshCalls(mock)).toBe(1);
  });

  it('shares one refresh between concurrent 401s', async () => {
    const mock = stubFetch([
      { status: 401 },
      { status: 401 },
      { status: 200, body: user },
      { status: 200, body: user },
    ]);

    await Promise.all([apiRequest('GET', '/a', { schema }), apiRequest('GET', '/b', { schema })]);

    expect(refreshCalls(mock)).toBe(1);
  });

  it('reports an expired session when the refresh fails', async () => {
    stubFetch(
      [
        {
          status: 401,
          body: { type: 'about:blank', title: 'Unauthorized', status: 401 },
          contentType: 'application/problem+json',
        },
      ],
      401,
    );
    const expired = vi.fn();
    onSessionExpired(expired);

    const err = await apiRequest('GET', '/auth/me').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 401 });
    expect(expired).toHaveBeenCalledOnce();
  });

  it('does not refresh when retryOnUnauthorized is off (sign-in)', async () => {
    const mock = stubFetch([{ status: 401 }]);

    await expect(
      apiRequest('POST', '/auth/login', { body: {}, retryOnUnauthorized: false }),
    ).rejects.toMatchObject({ status: 401 });
    expect(refreshCalls(mock)).toBe(0);
  });

  it('returns undefined for 204 responses', async () => {
    stubFetch([{ status: 204 }]);

    await expect(apiRequest('POST', '/auth/logout', { schema })).resolves.toBeUndefined();
  });
});

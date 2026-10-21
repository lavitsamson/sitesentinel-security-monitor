import { jest } from '@jest/globals';
import nock from 'nock';
import {
  MAX_REDIRECTS,
  SafeFetchError,
  buildUserAgent,
  createSafeHttpClient,
  parseTarget,
  pinnedLookup,
  resolveTarget,
  type LookupFn,
  type ResolvedAddress,
} from './safe-fetch.js';

const PUBLIC: ResolvedAddress = { address: '93.184.216.34', family: 4 };

/** A fake DNS: every name resolves to a public address unless listed. */
function fakeLookup(overrides: Record<string, ResolvedAddress[]> = {}) {
  return jest.fn<LookupFn>(async (hostname) => overrides[hostname] ?? [PUBLIC]);
}

function client(lookup: LookupFn = fakeLookup(), extra = {}) {
  return createSafeHttpClient({ lookup, userAgent: buildUserAgent('1.2.3'), ...extra });
}

async function errorOf(promise: Promise<unknown>): Promise<SafeFetchError> {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(err instanceof SafeFetchError)) throw new Error(`expected SafeFetchError, got ${err}`);
  return err;
}

beforeAll(() => nock.disableNetConnect());
afterEach(() => nock.cleanAll());
afterAll(() => nock.enableNetConnect());

describe('parseTarget', () => {
  it.each(['https://example.com/', 'http://example.com/x?y=1', 'https://example.com:443/'])(
    'accepts %s',
    (url) => {
      expect(parseTarget(url)).toBeInstanceOf(URL);
    },
  );

  it.each([
    ['file:///etc/passwd', /Protocol file:/],
    ['ftp://example.com/', /Protocol ftp:/],
    ['gopher://example.com/', /Protocol gopher:/],
    ['https://example.com:8080/', /Port 8080/],
    ['http://example.com:22/', /Port 22/],
    ['https://user:pass@example.com/', /credentials/],
    ['not a url', /Invalid URL/],
  ])('rejects %s', (url, message) => {
    expect(() => parseTarget(url)).toThrow(message);
  });
});

describe('resolveTarget', () => {
  it.each([
    'http://127.0.0.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://0.0.0.0/',
    'http://2130706433/', // decimal 127.0.0.1, canonicalised by the URL parser
  ])('blocks the IP literal in %s without a DNS lookup', async (raw) => {
    const lookup = fakeLookup();

    const err = await errorOf(resolveTarget(parseTarget(raw), lookup));

    expect(err.code).toBe('BLOCKED_ADDRESS');
    expect(lookup).not.toHaveBeenCalled();
  });

  it('blocks a hostname that resolves to a private address', async () => {
    const lookup = fakeLookup({ 'internal.example.com': [{ address: '10.0.0.5', family: 4 }] });

    const err = await errorOf(resolveTarget(parseTarget('https://internal.example.com/'), lookup));

    expect(err.code).toBe('BLOCKED_ADDRESS');
    expect(err.message).toContain('10.0.0.5');
  });

  it('blocks a hostname with mixed public and private answers (DNS rebinding)', async () => {
    const lookup = fakeLookup({
      'rebind.example.com': [PUBLIC, { address: '127.0.0.1', family: 4 }],
    });

    const err = await errorOf(resolveTarget(parseTarget('https://rebind.example.com/'), lookup));

    expect(err.code).toBe('BLOCKED_ADDRESS');
  });

  it('blocks IPv6 answers in private ranges', async () => {
    const lookup = fakeLookup({ 'v6.example.com': [{ address: 'fd00::1', family: 6 }] });

    const err = await errorOf(resolveTarget(parseTarget('https://v6.example.com/'), lookup));

    expect(err.code).toBe('BLOCKED_ADDRESS');
  });

  it('reports DNS failures and empty answers', async () => {
    const failing: LookupFn = async () => {
      throw new Error('ENOTFOUND');
    };
    const empty: LookupFn = async () => [];
    const url = parseTarget('https://example.com/');

    expect((await errorOf(resolveTarget(url, failing))).code).toBe('DNS_FAILURE');
    expect((await errorOf(resolveTarget(url, empty))).code).toBe('DNS_FAILURE');
  });

  it('returns the validated public address', async () => {
    await expect(resolveTarget(parseTarget('https://example.com/'), fakeLookup())).resolves.toEqual(
      PUBLIC,
    );
  });
});

describe('pinnedLookup', () => {
  it('always answers with the validated address, whatever hostname is asked for', () => {
    const lookup = pinnedLookup(PUBLIC);
    const single = jest.fn();
    const all = jest.fn();

    lookup('attacker-controlled.example', {}, single);
    lookup('attacker-controlled.example', { all: true }, all);

    expect(single).toHaveBeenCalledWith(null, PUBLIC.address, 4);
    expect(all).toHaveBeenCalledWith(null, [PUBLIC]);
  });
});

describe('createSafeHttpClient', () => {
  it('fetches a public URL and sends the SiteSentinel user agent', async () => {
    const scope = nock('https://example.com', {
      reqheaders: { 'user-agent': /^SiteSentinel\/1\.2\.3 \(\+https:\/\/github\.com\// },
    })
      .get('/')
      .reply(200, 'hello', { 'x-test': 'yes' });

    const res = await client().request({
      url: 'https://example.com/',
      method: 'GET',
      maxRedirects: 0,
    });

    expect(res).toMatchObject({
      status: 200,
      body: 'hello',
      url: 'https://example.com/',
      headers: { 'x-test': 'yes' },
    });
    expect(res.durationMs).toBeGreaterThanOrEqual(0);
    scope.done();
  });

  it('returns no body for HEAD', async () => {
    nock('https://example.com').head('/').reply(200);

    const res = await client().request({
      url: 'https://example.com/',
      method: 'HEAD',
      maxRedirects: 0,
    });

    expect(res).toMatchObject({ status: 200, body: '' });
  });

  it('returns the redirect itself when maxRedirects is 0', async () => {
    nock('http://example.com').get('/').reply(301, '', { location: 'https://example.com/' });

    const res = await client().request({
      url: 'http://example.com/',
      method: 'GET',
      maxRedirects: 0,
    });

    expect(res).toMatchObject({ status: 301, headers: { location: 'https://example.com/' } });
  });

  it('follows redirects, re-resolving each hop, and reports the final URL', async () => {
    const lookup = fakeLookup();
    nock('http://example.com').get('/').reply(301, '', { location: 'https://www.example.com/' });
    nock('https://www.example.com').get('/').reply(200, 'final');

    const res = await client(lookup).request({
      url: 'http://example.com/',
      method: 'GET',
      maxRedirects: 3,
    });

    expect(res).toMatchObject({ status: 200, body: 'final', url: 'https://www.example.com/' });
    expect(lookup.mock.calls.map(([host]) => host)).toEqual(['example.com', 'www.example.com']);
  });

  it('resolves relative Location headers against the current URL', async () => {
    nock('https://example.com')
      .get('/old')
      .reply(302, '', { location: '/new' })
      .get('/new')
      .reply(200, 'moved');

    const res = await client().request({
      url: 'https://example.com/old',
      method: 'GET',
      maxRedirects: 1,
    });

    expect(res).toMatchObject({ body: 'moved', url: 'https://example.com/new' });
  });

  it(`never follows more than ${MAX_REDIRECTS} redirects, whatever is requested`, async () => {
    const scope = nock('https://example.com');
    for (let i = 0; i < 5; i++) scope.get(`/${i}`).reply(302, '', { location: `/${i + 1}` });

    const res = await client().request({
      url: 'https://example.com/0',
      method: 'GET',
      maxRedirects: 10,
    });

    expect(res.status).toBe(302);
    expect(res.url).toBe(`https://example.com/${MAX_REDIRECTS}`);
    expect(scope.pendingMocks()).toHaveLength(5 - MAX_REDIRECTS - 1);
  });

  it('blocks a redirect to a private IP literal', async () => {
    nock('https://example.com')
      .get('/')
      .reply(302, '', { location: 'http://169.254.169.254/latest/meta-data/' });

    const err = await errorOf(
      client().request({ url: 'https://example.com/', method: 'GET', maxRedirects: 3 }),
    );

    expect(err.code).toBe('BLOCKED_ADDRESS');
  });

  it('blocks a redirect to a hostname that resolves privately', async () => {
    const lookup = fakeLookup({ 'evil.example.net': [{ address: '192.168.0.10', family: 4 }] });
    nock('https://example.com').get('/').reply(302, '', { location: 'https://evil.example.net/' });

    const err = await errorOf(
      client(lookup).request({ url: 'https://example.com/', method: 'GET', maxRedirects: 3 }),
    );

    expect(err.code).toBe('BLOCKED_ADDRESS');
  });

  it('blocks a redirect to a disallowed port or protocol', async () => {
    nock('https://example.com')
      .get('/a')
      .reply(302, '', { location: 'https://example.com:6379/' })
      .get('/b')
      .reply(302, '', { location: 'file:///etc/passwd' });
    const c = client();

    const port = await errorOf(
      c.request({ url: 'https://example.com/a', method: 'GET', maxRedirects: 3 }),
    );
    const protocol = await errorOf(
      c.request({ url: 'https://example.com/b', method: 'GET', maxRedirects: 3 }),
    );

    expect(port.code).toBe('BLOCKED_URL');
    expect(protocol.code).toBe('BLOCKED_URL');
  });

  it('aborts responses larger than the size cap', async () => {
    nock('https://example.com').get('/big').reply(200, 'x'.repeat(2_000));

    const err = await errorOf(
      client(fakeLookup(), { maxBytes: 1_000 }).request({
        url: 'https://example.com/big',
        method: 'GET',
        maxRedirects: 0,
      }),
    );

    expect(err.code).toBe('TOO_LARGE');
  });

  it('rejects early when Content-Length already exceeds the cap', async () => {
    nock('https://example.com').get('/').reply(200, 'small', { 'content-length': '5000000' });

    const err = await errorOf(
      client().request({ url: 'https://example.com/', method: 'GET', maxRedirects: 0 }),
    );

    expect(err.code).toBe('TOO_LARGE');
  });

  it('times out slow responses', async () => {
    nock('https://example.com').get('/').delay(500).reply(200, 'late');

    const err = await errorOf(
      client(fakeLookup(), { totalTimeoutMs: 50 }).request({
        url: 'https://example.com/',
        method: 'GET',
        maxRedirects: 0,
      }),
    );

    expect(err.code).toBe('TIMEOUT');
  });

  it('times out a DNS lookup that never answers', async () => {
    const hanging: LookupFn = () => new Promise(() => undefined);

    const err = await errorOf(
      client(hanging, { totalTimeoutMs: 50 }).request({
        url: 'https://example.com/',
        method: 'GET',
        maxRedirects: 0,
      }),
    );

    expect(err.code).toBe('TIMEOUT');
  });

  it('wraps network errors', async () => {
    nock('https://example.com').get('/').replyWithError('socket hang up');

    const err = await errorOf(
      client().request({ url: 'https://example.com/', method: 'GET', maxRedirects: 0 }),
    );

    expect(err.code).toBe('NETWORK');
    expect(err.message).toContain('socket hang up');
  });
});

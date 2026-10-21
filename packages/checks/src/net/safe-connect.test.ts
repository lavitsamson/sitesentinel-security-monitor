import { jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import net, { type AddressInfo } from 'node:net';
import tls from 'node:tls';
import { createSafeTlsConnector, type SafeTlsOptions } from './safe-connect.js';
import { SafeFetchError, type LookupFn, type ResolvedAddress } from './safe-fetch.js';

const fixture = (name: string) =>
  readFileSync(new URL(`../test/fixtures/tls/${name}`, import.meta.url), 'utf8');
const CA = fixture('ca.crt');

const LOOPBACK: ResolvedAddress = { address: '127.0.0.1', family: 4 };
const onlyLoopback = (address: string) => address === '127.0.0.1';
const lookup = jest.fn<LookupFn>(async () => [LOOPBACK]);

let server: tls.Server;
let port: number;

beforeAll(async () => {
  server = tls.createServer({
    // Send the leaf and the CA so the client sees a two-certificate chain.
    cert: fixture('server.crt') + fixture('ca.crt'),
    key: fixture('server.key'),
  });
  // The test server never needs to answer, just complete the handshake.
  server.on('secureConnection', (socket) => socket.end());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

function connector(overrides: Partial<SafeTlsOptions> = {}, ca: string | null = CA) {
  return createSafeTlsConnector({
    lookup,
    unsafeTesting: { port, ...(ca && { ca }), isAllowedAddress: onlyLoopback },
    ...overrides,
  });
}

async function errorOf(promise: Promise<unknown>): Promise<SafeFetchError> {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(err instanceof SafeFetchError)) throw new Error(`expected SafeFetchError, got ${err}`);
  return err;
}

describe('createSafeTlsConnector', () => {
  it('completes a trusted handshake and reports the chain', async () => {
    const result = await connector().handshake('tls.sitesentinel.test');

    expect(result.authorized).toBe(true);
    expect(result.authorizationError).toBeNull();
    expect(result.protocol).toBe('TLSv1.3');
    expect(result.chain).toHaveLength(2);
    const [leaf, root] = result.chain;
    expect(leaf).toMatchObject({
      subject: 'CN=tls.sitesentinel.test, O=SiteSentinel Tests',
      issuer: 'CN=SiteSentinel Test CA',
      subjectAltNames: ['tls.sitesentinel.test', '*.wild.sitesentinel.test'],
    });
    expect(leaf?.validTo.getUTCFullYear()).toBe(2126);
    expect(root?.subject).toBe('CN=SiteSentinel Test CA');
    expect(lookup).toHaveBeenCalledWith('tls.sitesentinel.test');
  });

  it('matches wildcard certificates', async () => {
    const result = await connector().handshake('a.wild.sitesentinel.test');

    expect(result.authorized).toBe(true);
  });

  it('reports, rather than throws, a hostname mismatch', async () => {
    const result = await connector().handshake('other.sitesentinel.test');

    expect(result.authorized).toBe(false);
    expect(result.authorizationError).toBe('ERR_TLS_CERT_ALTNAME_INVALID');
    expect(result.chain).toHaveLength(2);
  });

  it('reports an untrusted chain', async () => {
    const result = await connector({}, null).handshake('tls.sitesentinel.test');

    expect(result.authorized).toBe(false);
    expect(result.authorizationError).toBe('SELF_SIGNED_CERT_IN_CHAIN');
  });

  it('refuses names that resolve to private addresses under the default policy', async () => {
    const guarded = createSafeTlsConnector({ lookup });

    const err = await errorOf(guarded.handshake('tls.sitesentinel.test'));

    expect(err.code).toBe('BLOCKED_ADDRESS');
  });

  it('refuses mixed public and private answers (DNS rebinding)', async () => {
    const rebinding = jest.fn<LookupFn>(async () => [
      { address: '93.184.216.34', family: 4 },
      LOOPBACK,
    ]);

    const err = await errorOf(createSafeTlsConnector({ lookup: rebinding }).handshake('x.com'));

    expect(err.code).toBe('BLOCKED_ADDRESS');
  });

  it.each(['169.254.169.254', '[::1]', '10.0.0.1'])(
    'refuses the IP literal %s without a DNS lookup',
    async (host) => {
      const spy = jest.fn<LookupFn>(async () => [LOOPBACK]);

      const err = await errorOf(createSafeTlsConnector({ lookup: spy }).handshake(host));

      expect(err.code).toBe('BLOCKED_ADDRESS');
      expect(spy).not.toHaveBeenCalled();
    },
  );

  it('refuses hostnames that smuggle a port or path', async () => {
    const err = await errorOf(connector().handshake('example.com:8443'));

    expect(err.code).toBe('BLOCKED_URL');
  });

  it('wraps connection failures', async () => {
    const closed = net.createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const closedPort = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));

    const err = await errorOf(
      createSafeTlsConnector({
        lookup,
        unsafeTesting: { port: closedPort, isAllowedAddress: onlyLoopback },
      }).handshake('tls.sitesentinel.test'),
    );

    expect(err.code).toBe('NETWORK');
  });

  it('times out a server that accepts but never completes the handshake', async () => {
    const silent = net.createServer(() => undefined);
    await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve));
    const silentPort = (silent.address() as AddressInfo).port;

    try {
      const err = await errorOf(
        createSafeTlsConnector({
          lookup,
          totalTimeoutMs: 150,
          unsafeTesting: { port: silentPort, isAllowedAddress: onlyLoopback },
        }).handshake('tls.sitesentinel.test'),
      );

      expect(err.code).toBe('TIMEOUT');
      expect(err.message).toMatch(/exceeded 150 ms/);
    } finally {
      silent.close();
    }
  });

  it('times out a DNS lookup that never answers', async () => {
    const hanging = jest.fn<LookupFn>(() => new Promise(() => undefined));

    const err = await errorOf(
      createSafeTlsConnector({ lookup: hanging, totalTimeoutMs: 50 }).handshake('slow.example.com'),
    );

    expect(err.code).toBe('TIMEOUT');
  });
});

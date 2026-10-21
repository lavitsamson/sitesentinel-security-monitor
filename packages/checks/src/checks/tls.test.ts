import { fakeDeps, target } from '../test/fakes.js';
import type { PeerCertificateInfo, TlsHandshakeResult } from '../types.js';
import { hostnameMatches, tlsCheck } from './tls.js';

// The fake clock reads 2026-06-01T12:00Z.
const leaf = (overrides: Partial<PeerCertificateInfo> = {}): PeerCertificateInfo => ({
  subject: 'CN=example.com',
  issuer: "CN=R11, O=Let's Encrypt, C=US",
  subjectAltNames: ['example.com', 'www.example.com'],
  validFrom: new Date('2026-04-01T00:00:00Z'),
  validTo: new Date('2026-08-30T00:00:00Z'),
  ...overrides,
});

const handshake = (overrides: Partial<TlsHandshakeResult> = {}): TlsHandshakeResult => ({
  protocol: 'TLSv1.3',
  authorized: true,
  authorizationError: null,
  chain: [leaf(), { ...leaf(), subject: "CN=R11, O=Let's Encrypt, C=US", subjectAltNames: [] }],
  ...overrides,
});

const run = (result: TlsHandshakeResult) =>
  tlsCheck(target, fakeDeps({ tls: { handshake: async () => result } }));

const codes = (findings: { code: string }[]) => findings.map((f) => f.code);

describe('tlsCheck', () => {
  it('passes a valid, trusted TLS 1.3 certificate', async () => {
    const result = await run(handshake());

    expect(result).toMatchObject({ status: 'PASS', score: 100, findings: [] });
    expect(result.raw).toMatchObject({
      protocol: 'TLSv1.3',
      daysRemaining: 89,
      hostnameMatches: true,
      issuer: "CN=R11, O=Let's Encrypt, C=US",
      validTo: '2026-08-30T00:00:00.000Z',
    });
    expect(result.raw.chain).toHaveLength(2);
  });

  it('fails an expired certificate with score 0', async () => {
    const result = await run(
      handshake({
        authorized: false,
        authorizationError: 'CERT_HAS_EXPIRED',
        chain: [leaf({ validTo: new Date('2026-05-20T00:00:00Z') })],
      }),
    );

    expect(result.status).toBe('FAIL');
    expect(result.score).toBe(0);
    expect(codes(result.findings)).toEqual(['TLS_CERT_EXPIRED']);
    expect(result.findings[0]?.message).toContain('2026-05-20');
  });

  it('fails a certificate that is not yet valid', async () => {
    const result = await run(handshake({ chain: [leaf({ validFrom: new Date('2026-07-01Z') })] }));

    expect(result.status).toBe('FAIL');
    expect(codes(result.findings)).toEqual(['TLS_CERT_NOT_YET_VALID']);
  });

  it('fails a hostname mismatch', async () => {
    const result = await run(
      handshake({
        authorized: false,
        authorizationError: 'ERR_TLS_CERT_ALTNAME_INVALID',
        chain: [leaf({ subjectAltNames: ['other.org'] })],
      }),
    );

    expect(result.status).toBe('FAIL');
    expect(result.score).toBe(0);
    expect(codes(result.findings)).toEqual(['TLS_HOSTNAME_MISMATCH']);
    expect(result.findings[0]?.message).toContain('other.org');
  });

  it('fails an untrusted (self-signed) certificate', async () => {
    const result = await run(
      handshake({ authorized: false, authorizationError: 'DEPTH_ZERO_SELF_SIGNED_CERT' }),
    );

    expect(result.status).toBe('FAIL');
    expect(codes(result.findings)).toEqual(['TLS_CERT_UNTRUSTED']);
    expect(result.findings[0]?.message).toContain('DEPTH_ZERO_SELF_SIGNED_CERT');
  });

  it('warns when fewer than 14 days remain', async () => {
    const result = await run(
      handshake({ chain: [leaf({ validTo: new Date('2026-06-14T00:00Z') })] }),
    );

    expect(result.status).toBe('WARN');
    expect(result.score).toBe(75);
    expect(codes(result.findings)).toEqual(['TLS_CERT_EXPIRING_SOON']);
    expect(result.findings[0]?.message).toContain('12 day(s)');
  });

  it('does not warn at exactly 14 days', async () => {
    const result = await run(
      handshake({ chain: [leaf({ validTo: new Date('2026-06-15T12:00Z') })] }),
    );

    expect(result.status).toBe('PASS');
  });

  it.each(['TLSv1', 'TLSv1.1', 'SSLv3'])(
    'warns when the server negotiates %s',
    async (protocol) => {
      const result = await run(handshake({ protocol }));

      expect(result.status).toBe('WARN');
      expect(codes(result.findings)).toEqual(['TLS_PROTOCOL_OUTDATED']);
    },
  );

  it('notes, without penalty, a server stuck on TLS 1.2', async () => {
    const result = await run(handshake({ protocol: 'TLSv1.2' }));

    expect(result).toMatchObject({ status: 'PASS', score: 100 });
    expect(codes(result.findings)).toEqual(['TLS_NO_TLS13']);
  });

  it('fails when no certificate is presented', async () => {
    const result = await run(handshake({ chain: [] }));

    expect(result).toMatchObject({ status: 'FAIL', score: 0 });
    expect(codes(result.findings)).toEqual(['TLS_NO_CERTIFICATE']);
  });

  it('reports every problem at once', async () => {
    const result = await run(
      handshake({
        protocol: 'TLSv1',
        authorized: false,
        authorizationError: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
        chain: [leaf({ subjectAltNames: [], validTo: new Date('2026-01-01Z') })],
      }),
    );

    expect(codes(result.findings)).toEqual([
      'TLS_CERT_EXPIRED',
      'TLS_HOSTNAME_MISMATCH',
      'TLS_CERT_UNTRUSTED',
      'TLS_PROTOCOL_OUTDATED',
    ]);
    expect(result.findings[1]?.message).toContain('no names');
  });
});

describe('hostnameMatches', () => {
  it.each([
    ['example.com', ['example.com'], true],
    ['EXAMPLE.com', ['example.COM'], true],
    ['www.example.com', ['*.example.com'], true],
    ['example.com', ['*.example.com'], false],
    ['a.b.example.com', ['*.example.com'], false],
    ['example.com', ['www.example.com'], false],
    ['example.com', [], false],
    ['badexample.com', ['*.example.com'], false],
  ] as const)('%s vs %j → %s', (host, sans, expected) => {
    expect(hostnameMatches(host, sans)).toBe(expected);
  });
});

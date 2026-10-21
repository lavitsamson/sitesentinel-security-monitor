import { fakeDeps, fakeHttp, target } from '../test/fakes.js';
import { parseSecurityTxt, securityTxtCheck } from './security-txt.js';

const URL_ = 'https://example.com/.well-known/security.txt';
const TEXT = { 'content-type': 'text/plain; charset=utf-8' };

const run = (reply: Parameters<typeof fakeHttp>[0][string]) =>
  securityTxtCheck(target, fakeDeps({ http: fakeHttp({ [`GET ${URL_}`]: reply }) }));

const codes = (findings: { code: string }[]) => findings.map((f) => f.code);

// The fake clock reads 2026-06-01T12:00Z.
const VALID = [
  '# Security contacts for example.com',
  'Contact: mailto:security@example.com',
  'Contact: https://example.com/security',
  'Expires: 2026-12-31T23:59:59.000Z',
  'Preferred-Languages: en',
].join('\r\n');

describe('securityTxtCheck', () => {
  it('passes a valid file', async () => {
    const result = await run({ headers: TEXT, body: VALID, url: URL_ });

    expect(result).toMatchObject({ status: 'PASS', score: 100, findings: [] });
    expect(result.raw).toEqual({
      url: URL_,
      statusCode: 200,
      present: true,
      contacts: ['mailto:security@example.com', 'https://example.com/security'],
      expires: '2026-12-31T23:59:59.000Z',
      fields: ['contact', 'expires', 'preferred-languages'],
    });
  });

  it('follows up to 3 redirects, as RFC 9116 allows', async () => {
    const http = fakeHttp({ [`GET ${URL_}`]: { headers: TEXT, body: VALID } });

    await securityTxtCheck(target, fakeDeps({ http }));

    expect(http.calls[0]).toMatchObject({ maxRedirects: 3 });
  });

  it('reports a missing file as low severity', async () => {
    const result = await run({ status: 404 });

    expect(result).toMatchObject({ status: 'PASS', score: 90 });
    expect(codes(result.findings)).toEqual(['SECURITY_TXT_MISSING']);
    expect(result.findings[0]?.recommendation).toContain('Contact: mailto:security@example.com');
    expect(result.findings[0]?.recommendation).toContain('Expires: 2026-11-28');
  });

  it.each([
    ['an HTML content type', { 'content-type': 'text/html' }, 'Contact: x'],
    ['an HTML body', {}, '<!doctype html><title>Not found</title>'],
  ])('treats a soft 404 (%s) as missing', async (_, headers, body) => {
    const result = await run({ headers, body });

    expect(codes(result.findings)).toEqual(['SECURITY_TXT_MISSING']);
  });

  it('warns without Contact or Expires', async () => {
    const result = await run({ headers: TEXT, body: 'Preferred-Languages: en' });

    expect(result.status).toBe('WARN');
    expect(codes(result.findings)).toEqual(['SECURITY_TXT_NO_CONTACT', 'SECURITY_TXT_NO_EXPIRES']);
  });

  it('notes a contact that is not a URI', async () => {
    const result = await run({
      headers: TEXT,
      body: 'Contact: security@example.com\nExpires: 2026-12-31T00:00:00Z',
    });

    expect(codes(result.findings)).toEqual(['SECURITY_TXT_CONTACT_NOT_URI']);
  });

  it('warns about an expired file', async () => {
    const result = await run({
      headers: TEXT,
      body: 'Contact: mailto:a@example.com\nExpires: 2026-01-01T00:00:00Z',
    });

    expect(result.status).toBe('WARN');
    expect(codes(result.findings)).toEqual(['SECURITY_TXT_EXPIRED']);
    expect(result.raw.expires).toBe('2026-01-01T00:00:00.000Z');
  });

  it('warns about an unparseable or repeated Expires', async () => {
    const bad = await run({ headers: TEXT, body: 'Contact: mailto:a@example.com\nExpires: soon' });
    const twice = await run({
      headers: TEXT,
      body: 'Contact: mailto:a@example.com\nExpires: 2026-12-01T00:00Z\nExpires: 2026-12-02T00:00Z',
    });

    expect(codes(bad.findings)).toEqual(['SECURITY_TXT_INVALID_EXPIRES']);
    expect(codes(twice.findings)).toEqual(['SECURITY_TXT_INVALID_EXPIRES']);
    expect(twice.findings[0]?.message).toContain('more than one');
  });

  it('notes an Expires more than a year away', async () => {
    const result = await run({
      headers: TEXT,
      body: 'Contact: mailto:a@example.com\nExpires: 2030-01-01T00:00:00Z',
    });

    expect(result.status).toBe('PASS');
    expect(codes(result.findings)).toEqual(['SECURITY_TXT_EXPIRES_TOO_FAR']);
  });
});

describe('parseSecurityTxt', () => {
  it('collects repeated fields and skips comments and PGP armour', () => {
    const fields = parseSecurityTxt(
      [
        '-----BEGIN PGP SIGNED MESSAGE-----',
        'Hash: SHA256',
        '',
        '# comment: not a field',
        'Contact: mailto:a@example.com',
        'CONTACT: tel:+1-201-555-0123 ',
        '-----BEGIN PGP SIGNATURE-----',
      ].join('\n'),
    );

    expect(fields.get('contact')).toEqual(['mailto:a@example.com', 'tel:+1-201-555-0123']);
    expect([...fields.keys()]).toEqual(['hash', 'contact']);
  });
});

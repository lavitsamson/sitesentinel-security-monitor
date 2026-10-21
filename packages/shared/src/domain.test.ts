import { domainSchema, normalizeDomain } from './domain.js';

describe('normalizeDomain', () => {
  it.each([
    ['example.com', 'example.com'],
    ['  Example.COM  ', 'example.com'],
    ['https://example.com/', 'example.com'],
    ['HTTP://www.example.co.uk', 'www.example.co.uk'],
    ['example.com.', 'example.com'],
    ['bücher.de', 'xn--bcher-kva.de'],
    ['xn--bcher-kva.de', 'xn--bcher-kva.de'],
    ['münchen.xn--p1ai', 'xn--mnchen-3ya.xn--p1ai'],
    ['my-site.io', 'my-site.io'],
  ])('normalises %j to %j', (input, expected) => {
    expect(normalizeDomain(input)).toEqual({ ok: true, domain: expected });
  });

  it.each([
    ['', 'empty'],
    ['   ', 'blank'],
    ['example', 'single label'],
    ['localhost', 'localhost'],
    ['printer.local', 'mDNS name'],
    ['db.internal', 'private TLD'],
    ['foo.test', 'reserved TLD'],
    ['10.0.0.1', 'IPv4 literal'],
    ['127.1', 'shorthand IPv4'],
    ['0x7f.0.0.1', 'hex IPv4'],
    ['[::1]', 'IPv6 literal'],
    ['example.com:8080', 'port'],
    ['example.com/admin', 'path'],
    ['user@example.com', 'credentials'],
    ['exa mple.com', 'whitespace'],
    ['-bad.example.com', 'leading hyphen'],
    ['bad-.com', 'trailing hyphen'],
    ['example.c0m', 'numeric TLD'],
    [`${'a'.repeat(64)}.com`, 'label longer than 63'],
    [`${'a.'.repeat(127)}com`, 'longer than 253'],
    ['ftp://example.com', 'other scheme'],
  ])('rejects %j (%s)', (input) => {
    expect(normalizeDomain(input).ok).toBe(false);
  });
});

describe('domainSchema', () => {
  it('outputs the normalised domain', () => {
    expect(domainSchema.parse('https://Example.com/')).toBe('example.com');
  });

  it('reports the reason as the issue message', () => {
    const result = domainSchema.safeParse('localhost');
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/reserved|top-level/i);
  });
});

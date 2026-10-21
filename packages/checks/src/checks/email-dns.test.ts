import { dnsError, fakeDeps, fakeDns, target } from '../test/fakes.js';
import { SPF_MAX_LOOKUPS, countSpfLookups, emailDnsCheck, parseDmarc } from './email-dns.js';

const MX = {
  'example.com': [
    { exchange: 'mx2.example.com', priority: 20 },
    { exchange: 'mx1.example.com', priority: 10 },
  ],
};
const GOOD_SPF = 'v=spf1 include:_spf.google.com -all';
const GOOD_DMARC = 'v=DMARC1; p=reject; rua=mailto:dmarc@example.com';

function run(
  txt: Record<string, string[] | Error>,
  mx: Record<string, { exchange: string; priority: number }[]> = MX,
) {
  return emailDnsCheck(target, fakeDeps({ dns: fakeDns({ txt, mx }) }));
}

const codes = (findings: { code: string }[]) => findings.map((f) => f.code);

describe('emailDnsCheck', () => {
  it('passes MX + strict SPF + DMARC p=reject with reports', async () => {
    const result = await run({
      'example.com': ['google-site-verification=abc', GOOD_SPF],
      '_spf.google.com': ['v=spf1 include:_netblocks.google.com ~all'],
      '_dmarc.example.com': [GOOD_DMARC],
    });

    expect(result).toMatchObject({ status: 'PASS', score: 100, findings: [] });
    expect(result.raw).toEqual({
      mx: ['10 mx1.example.com', '20 mx2.example.com'],
      spf: GOOD_SPF,
      spfLookups: 2,
      dmarc: GOOD_DMARC,
      dmarcPolicy: 'reject',
    });
  });

  it('warns when SPF and DMARC are both missing', async () => {
    const result = await run({});

    expect(result).toMatchObject({ status: 'WARN', score: 50 });
    expect(codes(result.findings)).toEqual(['EMAIL_SPF_MISSING', 'EMAIL_DMARC_MISSING']);
    expect(result.findings[0]?.recommendation).toContain('include:');
  });

  it('notes a domain without MX records, and suggests locking it down', async () => {
    const result = await run({}, {});

    expect(codes(result.findings)).toEqual([
      'EMAIL_NO_MX',
      'EMAIL_SPF_MISSING',
      'EMAIL_DMARC_MISSING',
    ]);
    expect(result.findings[0]?.severity).toBe('info');
    expect(result.findings[1]?.recommendation).toContain('v=spf1 -all');
  });

  it('fails an SPF record ending in +all', async () => {
    const result = await run({
      'example.com': ['v=spf1 ip4:192.0.2.0/24 +all'],
      '_dmarc.example.com': [GOOD_DMARC],
    });

    expect(result.status).toBe('FAIL');
    expect(codes(result.findings)).toEqual(['EMAIL_SPF_PASS_ALL']);
  });

  it('treats a bare "all" as +all', async () => {
    const result = await run({
      'example.com': ['v=spf1 mx all'],
      '_dmarc.example.com': [GOOD_DMARC],
    });

    expect(codes(result.findings)).toEqual(['EMAIL_SPF_PASS_ALL']);
  });

  it('warns about ?all and notes a missing all or ptr', async () => {
    const neutral = await run({
      'example.com': ['v=spf1 mx ?all'],
      '_dmarc.example.com': [GOOD_DMARC],
    });
    const noAll = await run({
      'example.com': ['v=spf1 mx ptr'],
      '_dmarc.example.com': [GOOD_DMARC],
    });
    const redirect = await run({
      'example.com': ['v=spf1 redirect=_spf.example.net'],
      '_spf.example.net': ['v=spf1 -all'],
      '_dmarc.example.com': [GOOD_DMARC],
    });

    expect(neutral.status).toBe('WARN');
    expect(codes(neutral.findings)).toEqual(['EMAIL_SPF_NEUTRAL_ALL']);
    expect(codes(noAll.findings)).toEqual(['EMAIL_SPF_NO_ALL', 'EMAIL_SPF_PTR']);
    expect(noAll.status).toBe('PASS');
    expect(redirect.findings).toEqual([]);
  });

  it('fails multiple SPF records', async () => {
    const result = await run({
      'example.com': ['v=spf1 mx -all', 'v=spf1 include:mail.example.net -all'],
      '_dmarc.example.com': [GOOD_DMARC],
    });

    expect(result.status).toBe('FAIL');
    expect(codes(result.findings)).toEqual(['EMAIL_SPF_MULTIPLE']);
    expect(result.raw.spfLookups).toBeNull();
  });

  it('fails an SPF record that needs more than 10 lookups', async () => {
    const includes = Array.from({ length: 6 }, (_, i) => `include:s${i}.example.net`).join(' ');
    const txt: Record<string, string[]> = {
      'example.com': [`v=spf1 ${includes} -all`],
      '_dmarc.example.com': [GOOD_DMARC],
    };
    for (let i = 0; i < 6; i++) txt[`s${i}.example.net`] = [`v=spf1 a mx -all`];

    const result = await run(txt);

    expect(result.status).toBe('FAIL');
    expect(codes(result.findings)).toEqual(['EMAIL_SPF_TOO_MANY_LOOKUPS']);
    expect(result.raw.spfLookups).toBeGreaterThan(SPF_MAX_LOOKUPS);
  });

  it('warns about DMARC p=none', async () => {
    const result = await run({
      'example.com': [GOOD_SPF],
      '_dmarc.example.com': ['v=DMARC1; p=none; rua=mailto:d@example.com'],
    });

    expect(result).toMatchObject({ status: 'WARN', score: 75 });
    expect(codes(result.findings)).toEqual(['EMAIL_DMARC_POLICY_NONE']);
    expect(result.raw.dmarcPolicy).toBe('none');
  });

  it('flags an invalid or missing DMARC policy, missing rua and pct < 100', async () => {
    const invalid = await run({
      'example.com': [GOOD_SPF],
      '_dmarc.example.com': ['v=DMARC1; p=block'],
    });
    const partial = await run({
      'example.com': [GOOD_SPF],
      '_dmarc.example.com': ['v=DMARC1; p=quarantine; pct=25; rua=mailto:d@example.com'],
    });
    const noPolicy = await run({
      'example.com': [GOOD_SPF],
      '_dmarc.example.com': ['v=DMARC1; rua=mailto:x@example.com'],
    });

    expect(codes(invalid.findings)).toEqual(['EMAIL_DMARC_INVALID_POLICY', 'EMAIL_DMARC_NO_RUA']);
    expect(invalid.findings[0]?.message).toContain('p=block');
    expect(codes(partial.findings)).toEqual(['EMAIL_DMARC_PARTIAL']);
    expect(noPolicy.findings[0]?.message).toContain('no p= policy');
  });

  it('warns about multiple DMARC records', async () => {
    const result = await run({
      'example.com': [GOOD_SPF],
      '_dmarc.example.com': [GOOD_DMARC, 'v=DMARC1; p=none'],
    });

    expect(codes(result.findings)).toEqual(['EMAIL_DMARC_MULTIPLE']);
  });

  it('rejoins TXT records split into 255-byte chunks', async () => {
    const long = `v=spf1 ${Array.from({ length: 20 }, (_, i) => `ip4:198.51.100.${i}`).join(' ')} -all`;
    expect(long.length).toBeGreaterThan(255);

    const result = await run({ 'example.com': [long], '_dmarc.example.com': [GOOD_DMARC] });

    expect(result.raw.spf).toBe(long);
    expect(result.findings).toEqual([]);
  });

  it('throws on a resolver failure, so the run is an ERROR rather than a bad score', async () => {
    await expect(run({ 'example.com': dnsError('ETIMEOUT') })).rejects.toThrow('ETIMEOUT');
    await expect(
      emailDnsCheck(
        target,
        fakeDeps({ dns: fakeDns({ mx: { 'example.com': dnsError('ESERVFAIL') } }) }),
      ),
    ).rejects.toThrow('ESERVFAIL');
  });
});

describe('countSpfLookups', () => {
  it('counts a, mx, ptr, exists, include and redirect but not ip4/ip6/all', async () => {
    const dns = fakeDns();

    const count = await countSpfLookups(
      'v=spf1 ip4:192.0.2.1 ip6:2001:db8::1 a mx/24 a:x.example ptr exists:%{i}.x.example include:missing.example redirect=gone.example -all',
      dns,
    );

    expect(count).toBe(7);
  });

  it('follows nested includes', async () => {
    const dns = fakeDns({
      txt: { 'a.example': ['v=spf1 include:b.example -all'], 'b.example': ['v=spf1 mx a -all'] },
    });

    expect(await countSpfLookups('v=spf1 include:a.example -all', dns)).toBe(4);
  });

  it('counts an include loop as over the limit without looping forever', async () => {
    const dns = fakeDns({ txt: { 'a.example': ['v=spf1 include:example.com -all'] } });

    const count = await countSpfLookups('v=spf1 include:a.example -all', dns, 'example.com');

    expect(count).toBe(SPF_MAX_LOOKUPS + 1);
    expect(dns.txtQueries).toEqual(['a.example']);
  });

  it('stops querying once the limit is passed', async () => {
    const dns = fakeDns({
      txt: Object.fromEntries(
        Array.from({ length: 20 }, (_, i) => [
          `n${i}.example`,
          [`v=spf1 include:n${i + 1}.example`],
        ]),
      ),
    });

    const count = await countSpfLookups('v=spf1 include:n0.example', dns);

    expect(count).toBe(SPF_MAX_LOOKUPS + 1);
    expect(dns.txtQueries.length).toBeLessThanOrEqual(SPF_MAX_LOOKUPS + 1);
  });

  it('treats a failing nested lookup as a single lookup', async () => {
    const dns = fakeDns({ txt: { 'down.example': dnsError('ESERVFAIL') } });

    expect(await countSpfLookups('v=spf1 include:down.example -all', dns)).toBe(1);
  });
});

describe('parseDmarc', () => {
  it('parses tags case-insensitively, ignoring junk', () => {
    const tags = parseDmarc('v=DMARC1; P=Reject ; rua=mailto:a@b.c;;junk; sp=none');

    expect(tags.get('p')).toBe('Reject');
    expect(tags.get('rua')).toBe('mailto:a@b.c');
    expect(tags.get('sp')).toBe('none');
    expect(tags.has('junk')).toBe(false);
  });
});

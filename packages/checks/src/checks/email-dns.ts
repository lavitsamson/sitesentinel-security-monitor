import type { Check, DnsResolver, Finding } from '../types.js';
import { finding, isNoRecordError, resultFrom, txtRecords } from './result.js';

/** RFC 7208 §4.6.4: more than 10 DNS-querying terms is a permanent error. */
export const SPF_MAX_LOOKUPS = 10;

const isSpf = (record: string) => /^v=spf1(\s|$)/i.test(record);
const isDmarc = (record: string) => /^v=DMARC1\s*(;|$)/i.test(record);

/** Mechanisms and modifiers that each cost one DNS lookup. */
const LOOKUP_TERM = /^[+\-~?]?(include:|a(:|\/|$)|mx(:|\/|$)|ptr(:|$)|exists:|redirect=)/i;

/** The domain an `include:` or `redirect=` term points at. */
function nestedDomain(term: string): string | null {
  return /^[+\-~?]?(?:include:|redirect=)(.+)$/i.exec(term)?.[1]?.toLowerCase() ?? null;
}

/**
 * Counts the DNS lookups an SPF record needs, following include: and redirect=
 * recursively. Stops early once the limit is passed, and never queries the same
 * domain twice (loops count as over the limit). Nested lookups that fail count
 * as their one lookup and add nothing more.
 */
export async function countSpfLookups(
  record: string,
  dns: DnsResolver,
  domain?: string,
): Promise<number> {
  const visited = new Set<string>(domain ? [domain] : []);
  let count = 0;

  async function walk(spf: string): Promise<void> {
    for (const term of spf.split(/\s+/).slice(1)) {
      if (!LOOKUP_TERM.test(term)) continue;
      count += 1;
      if (count > SPF_MAX_LOOKUPS) return;
      const nested = nestedDomain(term);
      if (!nested) continue;
      if (visited.has(nested)) {
        count = SPF_MAX_LOOKUPS + 1;
        return;
      }
      visited.add(nested);
      const records = await txtRecords((h) => dns.resolveTxt(h), nested).catch(() => []);
      const nestedSpf = records.find(isSpf);
      if (nestedSpf) await walk(nestedSpf);
      if (count > SPF_MAX_LOOKUPS) return;
    }
  }

  await walk(record);
  return count;
}

/** `v=DMARC1; p=reject; rua=...` → lowercase tag → value. */
export function parseDmarc(record: string): Map<string, string> {
  const tags = new Map<string, string>();
  for (const part of record.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) tags.set(part.slice(0, eq).trim().toLowerCase(), part.slice(eq + 1).trim());
  }
  return tags;
}

async function evaluateSpf(
  domain: string,
  records: string[],
  dns: DnsResolver,
  hasMx: boolean,
): Promise<{ findings: Finding[]; record: string | null; lookups: number | null }> {
  const spf = records.filter(isSpf);
  if (spf.length === 0) {
    return {
      record: null,
      lookups: null,
      findings: [
        finding(
          'EMAIL_SPF_MISSING',
          'medium',
          `${domain} has no SPF record, so anyone can claim to send mail from it.`,
          hasMx
            ? `Publish a TXT record listing your mail senders, for example "v=spf1 include:_spf.google.com -all".`
            : `This domain doesn't receive mail; publish "v=spf1 -all" to say it never sends any either.`,
        ),
      ],
    };
  }
  if (spf.length > 1) {
    return {
      record: spf.join(' | '),
      lookups: null,
      findings: [
        finding(
          'EMAIL_SPF_MULTIPLE',
          'high',
          `${domain} has ${spf.length} SPF records; receivers treat that as a permanent error and ignore SPF.`,
          'Merge them into a single "v=spf1 ... -all" TXT record.',
        ),
      ],
    };
  }

  const record = spf[0] as string;
  const terms = record
    .split(/\s+/)
    .slice(1)
    .map((t) => t.toLowerCase());
  const findings: Finding[] = [];
  const all = terms.find((t) => /^[+\-~?]?all$/.test(t));

  if (all === 'all' || all === '+all') {
    findings.push(
      finding(
        'EMAIL_SPF_PASS_ALL',
        'high',
        'The SPF record ends in +all, which authorises every server on the internet to send as this domain.',
        'Replace +all with -all (or ~all while you are testing).',
      ),
    );
  } else if (all === '?all') {
    findings.push(
      finding(
        'EMAIL_SPF_NEUTRAL_ALL',
        'medium',
        'The SPF record ends in ?all (neutral), which gives receivers no instruction about unlisted senders.',
        'Replace ?all with -all, or ~all while you are testing.',
      ),
    );
  } else if (!all && !terms.some((t) => t.startsWith('redirect='))) {
    findings.push(
      finding(
        'EMAIL_SPF_NO_ALL',
        'low',
        'The SPF record has no "all" mechanism, so unlisted senders are treated as neutral.',
        'End the record with -all.',
      ),
    );
  }
  if (terms.some((t) => /^[+\-~?]?ptr(:|$)/.test(t))) {
    findings.push(
      finding(
        'EMAIL_SPF_PTR',
        'low',
        'The SPF record uses the ptr mechanism, which is slow, unreliable and deprecated (RFC 7208 §5.5).',
        'Replace ptr with ip4:/ip6: ranges or include: of your provider.',
      ),
    );
  }

  const lookups = await countSpfLookups(record, dns, domain);
  if (lookups > SPF_MAX_LOOKUPS) {
    findings.push(
      finding(
        'EMAIL_SPF_TOO_MANY_LOOKUPS',
        'high',
        `The SPF record needs more than ${SPF_MAX_LOOKUPS} DNS lookups, so receivers return a permanent error and SPF fails.`,
        'Remove senders you no longer use, or replace include: chains with ip4:/ip6: ranges (SPF flattening).',
      ),
    );
  }
  return { findings, record, lookups };
}

function evaluateDmarc(
  domain: string,
  records: string[],
): { findings: Finding[]; record: string | null; policy: string | null } {
  const dmarc = records.filter(isDmarc);
  const example = `v=DMARC1; p=quarantine; rua=mailto:dmarc@${domain}`;
  if (dmarc.length !== 1) {
    const multiple = dmarc.length > 1;
    return {
      record: multiple ? dmarc.join(' | ') : null,
      policy: null,
      findings: [
        finding(
          multiple ? 'EMAIL_DMARC_MULTIPLE' : 'EMAIL_DMARC_MISSING',
          'medium',
          multiple
            ? `_dmarc.${domain} has ${dmarc.length} DMARC records, so receivers ignore DMARC entirely.`
            : `${domain} has no DMARC record, so receivers have no policy for mail that fails SPF/DKIM.`,
          multiple
            ? 'Keep exactly one v=DMARC1 TXT record at _dmarc.'
            : `Publish a TXT record at _dmarc.${domain}: "${example}", then move to p=reject once reports look clean.`,
        ),
      ],
    };
  }

  const record = dmarc[0] as string;
  const tags = parseDmarc(record);
  const policy = tags.get('p')?.toLowerCase() ?? null;
  const findings: Finding[] = [];

  if (policy === 'none') {
    findings.push(
      finding(
        'EMAIL_DMARC_POLICY_NONE',
        'medium',
        'The DMARC policy is p=none: spoofed mail is reported but still delivered.',
        'Once your aggregate reports show legitimate mail passing, move to p=quarantine and then p=reject.',
      ),
    );
  } else if (policy !== 'quarantine' && policy !== 'reject') {
    findings.push(
      finding(
        'EMAIL_DMARC_INVALID_POLICY',
        'medium',
        `The DMARC record has ${policy ? `an invalid policy "p=${policy}"` : 'no p= policy'}, so receivers may ignore it.`,
        `Set a policy, for example "${example}".`,
      ),
    );
  }
  if (!tags.get('rua')) {
    findings.push(
      finding(
        'EMAIL_DMARC_NO_RUA',
        'low',
        'The DMARC record has no rua= address, so you never see who is sending mail as your domain.',
        `Add rua=mailto:dmarc@${domain} (or a DMARC reporting service) to receive aggregate reports.`,
      ),
    );
  }
  const pct = Number(tags.get('pct') ?? 100);
  if (Number.isFinite(pct) && pct < 100) {
    findings.push(
      finding(
        'EMAIL_DMARC_PARTIAL',
        'low',
        `The DMARC policy only applies to ${pct}% of failing mail (pct=${pct}).`,
        'Raise pct to 100, or remove the tag, once you are confident in the policy.',
      ),
    );
  }
  return { findings, record, policy };
}

/**
 * Public DNS only: MX, SPF (TXT on the domain, following include: to count
 * lookups) and DMARC (TXT on _dmarc). Lookups that fail for reasons other than
 * "no such record" throw, so a resolver outage is an ERROR, not a bad score.
 */
export const emailDnsCheck: Check = async ({ domain }, { dns }) => {
  let mx: { exchange: string; priority: number }[];
  try {
    mx = await dns.resolveMx(domain);
  } catch (err) {
    if (!isNoRecordError(err)) throw err;
    mx = [];
  }
  const [rootTxt, dmarcTxt] = await Promise.all([
    txtRecords((h) => dns.resolveTxt(h), domain),
    txtRecords((h) => dns.resolveTxt(h), `_dmarc.${domain}`),
  ]);

  const findings: Finding[] = [];
  if (mx.length === 0) {
    findings.push(
      finding(
        'EMAIL_NO_MX',
        'info',
        `${domain} has no MX records, so it does not receive email.`,
        'If this domain never sends mail, publish "v=spf1 -all" and a DMARC p=reject record so nobody can spoof it.',
      ),
    );
  }
  const spf = await evaluateSpf(domain, rootTxt, dns, mx.length > 0);
  const dmarc = evaluateDmarc(domain, dmarcTxt);
  findings.push(...spf.findings, ...dmarc.findings);

  return resultFrom(findings, {
    mx: [...mx].sort((a, b) => a.priority - b.priority).map((r) => `${r.priority} ${r.exchange}`),
    spf: spf.record,
    spfLookups: spf.lookups,
    dmarc: dmarc.record,
    dmarcPolicy: dmarc.policy,
  });
};

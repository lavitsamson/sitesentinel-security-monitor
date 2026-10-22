import type { Check, Finding } from '../types.js';
import { DAY_MS, finding, resultFrom } from './result.js';

export const SECURITY_TXT_PATH = '/.well-known/security.txt';

/** `Field: value` lines (RFC 9116 §2.4), lowercased names, comments and PGP armour skipped. */
export function parseSecurityTxt(body: string): Map<string, string[]> {
  const fields = new Map<string, string[]>();
  for (const line of body.split(/\r?\n/)) {
    // No lazy group followed by \s*$: on a body the server controls, that backtracks
    // quadratically (a 1 MB line of spaces took minutes). Match, then trim.
    const match = /^([A-Za-z][A-Za-z0-9-]*):(.*)$/.exec(line);
    const value = match?.[2]?.trim();
    if (!match || !value) continue;
    const name = (match[1] as string).toLowerCase();
    fields.set(name, [...(fields.get(name) ?? []), value]);
  }
  return fields;
}

/** An HTML page answering 200 for every path (a "soft 404") is not a security.txt. */
function looksLikeHtml(contentType: string | undefined, body: string): boolean {
  return /html/i.test(contentType ?? '') || /^\s*</.test(body);
}

export const securityTxtCheck: Check = async ({ domain }, { http, clock }) => {
  const url = `https://${domain}${SECURITY_TXT_PATH}`;
  const res = await http.request({ url, method: 'GET', maxRedirects: 3 });
  const example = `Contact: mailto:security@${domain}\nExpires: ${new Date(clock.now().getTime() + 180 * DAY_MS).toISOString()}`;

  if (res.status !== 200 || looksLikeHtml(res.headers['content-type'], res.body)) {
    return resultFrom(
      [
        finding(
          'SECURITY_TXT_MISSING',
          'low',
          `No security.txt at ${url}, so security researchers have no published way to reach you.`,
          `Publish ${SECURITY_TXT_PATH} (RFC 9116) as text/plain containing at least:\n${example}`,
        ),
      ],
      { url, statusCode: res.status, present: false },
    );
  }

  const fields = parseSecurityTxt(res.body);
  const contacts = fields.get('contact') ?? [];
  const expiresValues = fields.get('expires') ?? [];
  const findings: Finding[] = [];

  if (contacts.length === 0) {
    findings.push(
      finding(
        'SECURITY_TXT_NO_CONTACT',
        'medium',
        'security.txt has no Contact field, which is required.',
        `Add a line such as "Contact: mailto:security@${domain}".`,
      ),
    );
  } else if (contacts.some((c) => !/^(mailto|https|tel):/i.test(c))) {
    findings.push(
      finding(
        'SECURITY_TXT_CONTACT_NOT_URI',
        'low',
        'A Contact field is not a mailto:, https: or tel: URI.',
        `Write contacts as URIs, for example "Contact: mailto:security@${domain}".`,
      ),
    );
  }

  let expires: Date | null = null;
  if (expiresValues.length !== 1) {
    findings.push(
      finding(
        expiresValues.length === 0 ? 'SECURITY_TXT_NO_EXPIRES' : 'SECURITY_TXT_INVALID_EXPIRES',
        'medium',
        expiresValues.length === 0
          ? 'security.txt has no Expires field, which is required so stale files are ignored.'
          : 'security.txt has more than one Expires field; it must appear exactly once.',
        'Add exactly one "Expires:" line with an ISO 8601 date less than a year away.',
      ),
    );
  } else {
    const parsed = new Date(expiresValues[0] as string);
    const now = clock.now();
    if (Number.isNaN(parsed.getTime())) {
      findings.push(
        finding(
          'SECURITY_TXT_INVALID_EXPIRES',
          'medium',
          `The Expires value "${expiresValues[0]}" is not a valid date.`,
          'Use an ISO 8601 timestamp, for example 2027-01-01T00:00:00.000Z.',
        ),
      );
    } else if (parsed < now) {
      expires = parsed;
      findings.push(
        finding(
          'SECURITY_TXT_EXPIRED',
          'medium',
          `security.txt expired on ${parsed.toISOString().slice(0, 10)}, so researchers should treat it as stale.`,
          'Review the contacts and set Expires to a date less than a year away.',
        ),
      );
    } else {
      expires = parsed;
      if (parsed.getTime() - now.getTime() > 366 * DAY_MS) {
        findings.push(
          finding(
            'SECURITY_TXT_EXPIRES_TOO_FAR',
            'low',
            'Expires is more than a year away; RFC 9116 recommends less, so the file gets reviewed.',
            'Set Expires to less than a year ahead and renew it when you review the file.',
          ),
        );
      }
    }
  }

  return resultFrom(findings, {
    url: res.url,
    statusCode: res.status,
    present: true,
    contacts,
    expires: expires?.toISOString() ?? null,
    fields: [...fields.keys()],
  });
};

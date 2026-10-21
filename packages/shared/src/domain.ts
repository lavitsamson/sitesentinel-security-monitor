import { z } from 'zod';

export type DomainParseResult = { ok: true; domain: string } | { ok: false; reason: string };

/** Special-use and private-network names that can never be a verifiable public site. */
const RESERVED_TLDS = new Set([
  'localhost',
  'local',
  'internal',
  'test',
  'invalid',
  'example',
  'onion',
  'arpa',
  'lan',
  'home',
  'corp',
  'intranet',
]);

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const TLD = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;
const DOTTED_QUAD = /^\d{1,3}(?:\.\d{1,3}){3}$/;

const fail = (reason: string): DomainParseResult => ({ ok: false, reason });

/**
 * Normalises user input to a lowercase, punycode hostname such as `xn--bcher-kva.de`.
 * A pasted URL like `https://Example.com/` is accepted; ports, paths, credentials,
 * IP addresses and private names are rejected. Runs in Node and the browser.
 */
export function normalizeDomain(input: string): DomainParseResult {
  let value = input.trim().replace(/^https?:\/\//i, '');
  if (value.endsWith('/')) value = value.slice(0, -1);
  if (value.endsWith('.')) value = value.slice(0, -1); // fully-qualified form
  if (!value) return fail('Enter a domain such as example.com');
  if (/[/?#@:\\\s[\]]/.test(value)) {
    return fail('Enter just the domain (such as example.com), without a port, path or IP address');
  }

  let host: string;
  try {
    // The WHATWG URL parser lowercases and converts IDNs to punycode.
    host = new URL(`http://${value}`).hostname;
  } catch {
    return fail('Not a valid domain name');
  }

  // The URL parser also canonicalises shorthand IPv4 forms (e.g. `127.1`), so test after it.
  if (DOTTED_QUAD.test(host)) return fail('IP addresses cannot be monitored; use a domain name');
  if (host.length > 253) return fail('Domain is too long');

  const labels = host.split('.');
  const tld = labels.at(-1) ?? '';
  if (labels.length < 2) return fail('Include the top-level domain, such as example.com');
  if (!labels.every((label) => LABEL.test(label))) return fail('Not a valid domain name');
  if (!TLD.test(tld)) return fail('Not a valid top-level domain');
  if (RESERVED_TLDS.has(tld)) return fail('Private or reserved domains cannot be monitored');

  return { ok: true, domain: host };
}

/** Accepts loose user input and outputs the normalised domain. */
export const domainSchema = z
  .string()
  .max(300)
  .transform((value, ctx) => {
    const result = normalizeDomain(value);
    if (!result.ok) {
      ctx.addIssue({ code: 'custom', message: result.reason });
      return z.NEVER;
    }
    return result.domain;
  });

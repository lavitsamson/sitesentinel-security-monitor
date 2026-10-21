import { Resolver, lookup } from 'node:dns/promises';
import type { DnsResolver } from '../types.js';
import type { LookupFn } from './safe-fetch.js';

/** Production address lookup (OS resolver), returning every address. Tests inject a fake. */
export const systemLookup: LookupFn = async (hostname) => {
  const answers = await lookup(hostname, { all: true, order: 'verbatim' });
  return answers.map(({ address, family }) => ({ address, family: family === 6 ? 6 : 4 }));
};

/** Production public-DNS record lookups with a bounded timeout. Tests inject a fake. */
export function createSystemDnsResolver(timeoutMs = 5_000): DnsResolver {
  const resolver = new Resolver({ timeout: timeoutMs, tries: 2 });
  return {
    resolveTxt: (hostname) => resolver.resolveTxt(hostname),
    resolveMx: (hostname) => resolver.resolveMx(hostname),
  };
}

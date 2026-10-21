import { BlockList, isIP } from 'node:net';

/**
 * IPv4 ranges that must never be the target of an outbound request: private,
 * loopback, link-local (incl. cloud metadata 169.254.169.254), CGNAT, multicast,
 * documentation, benchmarking and reserved space (IANA special-purpose registry).
 */
const BLOCKED_V4_SUBNETS: [string, number][] = [
  ['0.0.0.0', 8], // "this network", incl. 0.0.0.0
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, cloud metadata
  ['172.16.0.0', 12],
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.88.99.0', 24], // 6to4 relay anycast
  ['192.168.0.0', 16],
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, incl. broadcast
];

/**
 * IPv6 is allow-listed to global unicast (2000::/3) first; these are the
 * special-purpose blocks inside it that are still refused.
 */
const BLOCKED_V6_SUBNETS: [string, number][] = [
  ['2001::', 23], // IETF protocol assignments, incl. Teredo and ORCHID
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4, which can tunnel to any embedded IPv4 address
  ['3fff::', 20], // documentation
];

const blockedV4 = new BlockList();
for (const [network, prefix] of BLOCKED_V4_SUBNETS) blockedV4.addSubnet(network, prefix, 'ipv4');

const blockedV6 = new BlockList();
for (const [network, prefix] of BLOCKED_V6_SUBNETS) blockedV6.addSubnet(network, prefix, 'ipv6');

/** Expands a valid IPv6 address (any notation) to its eight 16-bit groups. */
function ipv6Groups(address: string): number[] {
  let text = address;
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number) as [number, number, number, number];
    text = `${text.slice(0, dotted.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const parse = (part: string) => (part ? part.split(':').map((g) => parseInt(g, 16)) : []);
  const [head = '', tail] = text.split('::');
  const left = parse(head);
  if (tail === undefined) return left;
  const right = parse(tail);
  return [...left, ...new Array<number>(8 - left.length - right.length).fill(0), ...right];
}

/** The IPv4 address hidden inside an IPv4-mapped (::ffff:a.b.c.d) or NAT64 (64:ff9b::) address. */
function embeddedIpv4(groups: number[]): string | null {
  const [g0, g1, g2, g3, g4, g5, g6 = 0, g7 = 0] = groups;
  const isMapped = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff;
  const isNat64 = g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0;
  if (!isMapped && !isNat64) return null;
  return [g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff].join('.');
}

/**
 * True only for addresses on the public internet. Anything unparseable, scoped
 * (`fe80::1%eth0`) or special-purpose is refused, so the default is deny.
 */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blockedV4.check(address, 'ipv4');
  if (family !== 6 || address.includes('%')) return false;

  const groups = ipv6Groups(address);
  const v4 = embeddedIpv4(groups);
  if (v4) return isPublicAddress(v4);

  const isGlobalUnicast = ((groups[0] ?? 0) & 0xe000) === 0x2000;
  return isGlobalUnicast && !blockedV6.check(address, 'ipv6');
}

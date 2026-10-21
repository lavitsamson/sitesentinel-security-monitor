import { isPublicAddress } from './ip-policy.js';

describe('isPublicAddress', () => {
  it.each([
    // IPv4 special-purpose ranges
    ['0.0.0.0', 'unspecified'],
    ['0.1.2.3', '"this network"'],
    ['10.0.0.1', 'RFC 1918 10/8'],
    ['10.255.255.255', 'RFC 1918 10/8 upper bound'],
    ['100.64.0.1', 'carrier-grade NAT'],
    ['127.0.0.1', 'loopback'],
    ['127.255.255.254', 'loopback upper range'],
    ['169.254.169.254', 'cloud metadata'],
    ['169.254.0.1', 'link-local'],
    ['172.16.0.1', 'RFC 1918 172.16/12'],
    ['172.31.255.255', 'RFC 1918 172.16/12 upper bound'],
    ['192.0.0.8', 'IETF protocol assignments'],
    ['192.0.2.1', 'TEST-NET-1'],
    ['192.88.99.1', '6to4 relay'],
    ['192.168.1.1', 'RFC 1918 192.168/16'],
    ['198.18.0.1', 'benchmarking'],
    ['198.51.100.7', 'TEST-NET-2'],
    ['203.0.113.9', 'TEST-NET-3'],
    ['224.0.0.1', 'multicast'],
    ['239.255.255.250', 'multicast (SSDP)'],
    ['240.0.0.1', 'reserved'],
    ['255.255.255.255', 'broadcast'],
    // IPv6
    ['::', 'unspecified'],
    ['::1', 'loopback'],
    ['0:0:0:0:0:0:0:1', 'loopback, uncompressed'],
    ['0000:0000:0000:0000:0000:0000:0000:0001', 'loopback, zero-padded'],
    ['fe80::1', 'link-local'],
    ['fe80::1%eth0', 'link-local with zone id'],
    ['fc00::1', 'unique local'],
    ['fd12:3456:789a::1', 'unique local (fd)'],
    ['fec0::1', 'deprecated site-local'],
    ['ff02::1', 'multicast'],
    ['::ffff:127.0.0.1', 'IPv4-mapped loopback'],
    ['::ffff:7f00:1', 'IPv4-mapped loopback, hex'],
    ['::ffff:169.254.169.254', 'IPv4-mapped metadata'],
    ['::ffff:10.0.0.1', 'IPv4-mapped private'],
    ['::127.0.0.1', 'IPv4-compatible (deprecated)'],
    ['64:ff9b::a00:1', 'NAT64 of 10.0.0.1'],
    ['64:ff9b::169.254.169.254', 'NAT64 of metadata'],
    ['64:ff9b:1::1', 'local-use NAT64'],
    ['100::1', 'discard-only'],
    ['2001::1', 'Teredo'],
    ['2001:10::1', 'ORCHID'],
    ['2001:db8::1', 'documentation'],
    ['2002:7f00:1::1', '6to4 wrapping 127.0.0.1'],
    ['3fff::1', 'documentation (2024)'],
    // Not IP addresses at all
    ['', 'empty'],
    ['localhost', 'hostname'],
    ['127.1', 'shorthand IPv4'],
    ['0x7f000001', 'hex IPv4'],
    ['999.1.1.1', 'out-of-range octet'],
  ])('blocks %s (%s)', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each([
    ['93.184.216.34', 'public IPv4'],
    ['1.1.1.1', 'public resolver'],
    ['8.8.8.8', 'public resolver'],
    ['172.32.0.1', 'just above 172.16/12'],
    ['100.128.0.1', 'just above CGNAT'],
    ['2606:4700:4700::1111', 'public IPv6'],
    ['2a00:1450:4001:80b::200e', 'public IPv6'],
    ['::ffff:93.184.216.34', 'IPv4-mapped public'],
    ['64:ff9b::5db8:d822', 'NAT64 of a public IPv4'],
  ])('allows %s (%s)', (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });
});

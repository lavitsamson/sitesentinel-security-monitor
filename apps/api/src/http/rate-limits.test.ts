import { clientIp } from './rate-limits.js';

describe('clientIp', () => {
  it('keys IPv4 by address and IPv6 by /56', () => {
    expect(clientIp({ ip: '203.0.113.7' })).toBe('203.0.113.7');
    expect(clientIp({ ip: '2001:db8:aa:bb01::1' })).toBe(clientIp({ ip: '2001:db8:aa:bbff::2' }));
  });

  it('puts over-long (forged) addresses in one shared bucket without parsing them', () => {
    const forged = `fe80::1%${'a'.repeat(10_000)}`;
    expect(clientIp({ ip: forged })).toBe('invalid-ip');
    expect(clientIp({ ip: `${forged}b` })).toBe('invalid-ip');
  });
});

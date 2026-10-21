import { buildAlertMessage, formatDuration, type AlertSubject } from './alert-message.js';

const ORIGIN = 'https://app.sitesentinel.test';
const SENT_AT = new Date('2026-10-21T12:00:00Z');

const incident = {
  id: 'inc1',
  type: 'TLS' as const,
  summary: 'TLS check failed for shop.example.com: Certificate expired',
  openedAt: new Date('2026-10-21T09:00:00Z'),
  resolvedAt: null,
};
const site = { id: 'site1', domain: 'shop.example.com', displayName: 'Shop' };

describe('formatDuration', () => {
  it.each([
    [0, '0s'],
    [45_000, '45s'],
    [5 * 60_000, '5m'],
    [3 * 3_600_000, '3h'],
    [3 * 3_600_000 + 5 * 60_000, '3h 5m'],
    [2 * 86_400_000, '2d'],
    [2 * 86_400_000 + 4 * 3_600_000, '2d 4h'],
    [-1_000, '0s'],
  ])('%i ms is %s', (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });
});

describe('buildAlertMessage', () => {
  it('describes an opened incident with a link to the site', () => {
    const message = buildAlertMessage({ event: 'OPENED', incident, site }, ORIGIN, SENT_AT);

    expect(message.subject).toBe('[SiteSentinel] Incident: shop.example.com TLS certificate');
    expect(message.text).toContain('Incident opened on Shop (shop.example.com): TLS check failed');
    expect(message.text).toContain(`${ORIGIN}/sites/site1`);
    expect(message.text).not.toContain('Resolved:');
    expect(message.payload).toEqual({
      event: 'incident.opened',
      text: expect.stringContaining(`${ORIGIN}/sites/site1`),
      sentAt: SENT_AT.toISOString(),
      incident: {
        id: 'inc1',
        type: 'TLS',
        summary: incident.summary,
        openedAt: incident.openedAt.toISOString(),
        resolvedAt: null,
        url: `${ORIGIN}/sites/site1`,
      },
      site,
    });
  });

  it('says how long a resolved incident lasted', () => {
    const resolved: AlertSubject = {
      event: 'RESOLVED',
      incident: { ...incident, resolvedAt: new Date('2026-10-21T11:05:00Z') },
      site: { ...site, displayName: site.domain },
    };

    const message = buildAlertMessage(resolved, ORIGIN, SENT_AT);

    expect(message.subject).toBe('[SiteSentinel] Resolved: shop.example.com TLS certificate');
    expect(message.payload.event).toBe('incident.resolved');
    expect(message.payload.text).toMatch(
      /^\[SiteSentinel\] Resolved on shop\.example\.com after 2h 5m: /,
    );
    expect(message.text).toContain('Resolved: 2026-10-21T11:05:00.000Z');
  });

  it('builds a test message without incident or site', () => {
    const message = buildAlertMessage({ event: 'TEST' }, ORIGIN, SENT_AT);

    expect(message.subject).toBe('[SiteSentinel] Test alert');
    expect(message.payload).toMatchObject({ event: 'test', incident: null, site: null });
    expect(message.text).toContain(`${ORIGIN}/alert-channels`);
  });
});

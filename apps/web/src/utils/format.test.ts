import { describe, expect, it } from 'vitest';
import { describeBulkResult } from './bulk';
import { duration, elapsed, plural, relativeTime } from './format';

const now = new Date('2026-10-21T12:00:00Z');

describe('relativeTime', () => {
  it.each([
    ['2026-10-21T11:59:30Z', 'just now'],
    ['2026-10-21T11:55:00Z', '5 minutes ago'],
    ['2026-10-21T09:00:00Z', '3 hours ago'],
    ['2026-10-20T12:00:00Z', 'yesterday'],
    ['2026-10-07T12:00:00Z', '2 weeks ago'],
    ['2026-10-21T14:00:00Z', 'in 2 hours'],
  ])('formats %s as %j', (iso, expected) => {
    expect(relativeTime(iso, now)).toBe(expected);
  });

  it('says never for a missing time', () => {
    expect(relativeTime(null, now)).toBe('never');
  });
});

describe('elapsed', () => {
  it.each([
    ['2026-10-21T11:59:30Z', 'under a minute'],
    ['2026-10-21T11:00:00Z', '1 hour'],
    ['2026-10-19T10:00:00Z', '2 days'],
  ])('measures from %s', (from, expected) => {
    expect(elapsed(from, now.toISOString())).toBe(expected);
  });
});

describe('duration and plural', () => {
  it('formats milliseconds and seconds', () => {
    expect(duration(850.4)).toBe('850 ms');
    expect(duration(3210)).toBe('3.2 s');
  });

  it('pluralises', () => {
    expect(plural(1, 'site')).toBe('1 site');
    expect(plural(0, 'site')).toBe('0 sites');
  });
});

describe('describeBulkResult', () => {
  it('reports what was done', () => {
    expect(describeBulkResult({ action: 'PAUSE', succeeded: ['a', 'b'], skipped: [] })).toBe(
      'Paused 2 sites.',
    );
  });

  it('groups skipped sites by reason', () => {
    expect(
      describeBulkResult({
        action: 'CHECK_NOW',
        succeeded: ['a'],
        skipped: [
          { id: 'b', reason: 'NOT_VERIFIED' },
          { id: 'c', reason: 'NOT_VERIFIED' },
          { id: 'd', reason: 'DEMO' },
        ],
      }),
    ).toBe('Queued checks for 1 site. Skipped 3: 2 not verified, 1 demo data.');
  });
});

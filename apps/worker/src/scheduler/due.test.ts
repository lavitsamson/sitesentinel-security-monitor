import { MAX_JITTER_MS, checkSlot, jitterMs, verificationSlot } from './due.js';

describe('checkSlot', () => {
  it('is derived from lastCheckedAt, so it only changes once a check completes', () => {
    const at = new Date('2026-10-21T09:00:00.000Z');
    expect(checkSlot(at)).toBe(String(at.getTime()));
    expect(checkSlot(new Date(at))).toBe(checkSlot(at));
    expect(checkSlot(new Date(at.getTime() + 1))).not.toBe(checkSlot(at));
  });

  it('has a fixed slot for a site that was never checked', () => {
    expect(checkSlot(null)).toBe('first');
    expect(verificationSlot(null)).toBe('first');
  });
});

describe('jitterMs', () => {
  const ids = Array.from({ length: 200 }, (_, i) => i.toString(16).padStart(24, '0'));

  it('is stable for a site', () => {
    expect(jitterMs(ids[7]!, 60)).toBe(jitterMs(ids[7]!, 60));
  });

  it.each([
    [5, 30_000],
    [15, MAX_JITTER_MS],
    [1440, MAX_JITTER_MS],
  ])('stays within the window for a %i-minute interval', (interval, window) => {
    for (const id of ids) {
      const delay = jitterMs(id, interval);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThan(window);
    }
  });

  it('spreads sites across the window', () => {
    const buckets = new Set(ids.map((id) => Math.floor(jitterMs(id, 60) / 6_000)));
    expect(buckets.size).toBe(10); // every 6-second bucket of the minute is used
  });
});

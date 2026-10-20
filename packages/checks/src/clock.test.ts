import { fixedClock, systemClock } from './clock.js';

describe('fixedClock', () => {
  it('always returns the same instant', () => {
    const clock = fixedClock('2026-01-01T00:00:00.000Z');
    expect(clock.now().toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(clock.now().toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('returns a fresh Date so callers cannot mutate the clock', () => {
    const clock = fixedClock('2026-01-01T00:00:00.000Z');
    clock.now().setFullYear(1999);
    expect(clock.now().getUTCFullYear()).toBe(2026);
  });

  it('rejects an invalid timestamp', () => {
    expect(() => fixedClock('not-a-date')).toThrow(RangeError);
  });
});

describe('systemClock', () => {
  it('returns the current time', () => {
    const before = Date.now();
    const now = systemClock.now().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });
});

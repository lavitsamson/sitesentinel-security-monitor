import type { Clock } from './types.js';

export const systemClock: Clock = {
  now: () => new Date(),
};

/** A clock frozen at `iso`, for deterministic tests (certificate expiry etc.). */
export function fixedClock(iso: string): Clock {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) {
    throw new RangeError(`Invalid ISO timestamp: ${iso}`);
  }
  return { now: () => new Date(instant) };
}

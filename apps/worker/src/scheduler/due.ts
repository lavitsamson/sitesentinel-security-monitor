import {
  CHECK_INTERVAL_MINUTES,
  REVERIFY_AFTER_DAYS,
  REVERIFY_RETRY_AFTER_DAYS,
} from '@sitesentinel/shared';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** Upper bound on scheduler jitter; short intervals get at most a tenth of their period. */
export const MAX_JITTER_MS = 60_000;

/**
 * The slot of a scheduled check is the `lastCheckedAt` it was scheduled from.
 * Every tick until the check completes sees the same lastCheckedAt, so it
 * produces the same job id and BullMQ drops the duplicate. Completing a check
 * moves lastCheckedAt, which is what opens the next slot.
 */
export function checkSlot(lastCheckedAt: Date | null): string {
  return lastCheckedAt ? String(lastCheckedAt.getTime()) : 'first';
}

/** Same idea for re-verification: the slot is the last attempt it follows. */
export function verificationSlot(lastAttemptAt: Date | null): string {
  return lastAttemptAt ? String(lastAttemptAt.getTime()) : 'first';
}

/** FNV-1a: a small, stable string hash. */
function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * Delay before a site's scheduled checks start. Derived from the site id, so a
 * site keeps a steady cadence while sites due at the same moment (e.g. after a
 * restart, or all created on the hour) are spread across the window.
 */
export function jitterMs(siteId: string, intervalMinutes: number): number {
  const window = Math.min(MAX_JITTER_MS, (intervalMinutes * MINUTE_MS) / 10);
  return fnv1a(siteId) % window;
}

/**
 * Verified, unpaused sites whose last check is at least one interval old (or
 * that were never checked). One clause per allowed interval keeps the query on
 * the `{ paused, checkIntervalMinutes, lastCheckedAt }` index.
 */
export function dueChecksFilter(now: Date) {
  return {
    paused: false,
    'verification.verifiedAt': { $ne: null },
    $or: [
      { lastCheckedAt: null },
      ...CHECK_INTERVAL_MINUTES.map((minutes) => ({
        checkIntervalMinutes: minutes,
        lastCheckedAt: { $lte: new Date(now.getTime() - minutes * MINUTE_MS) },
      })),
    ],
  };
}

/**
 * Verified, unpaused, non-demo sites due to re-prove ownership: a week after the
 * last attempt, or a day after a failed one. Demo sites were never verified for real.
 */
export function dueReverificationFilter(now: Date) {
  const weekAgo = new Date(now.getTime() - REVERIFY_AFTER_DAYS * DAY_MS);
  const retryCutoff = new Date(now.getTime() - REVERIFY_RETRY_AFTER_DAYS * DAY_MS);
  return {
    paused: false,
    demo: false,
    'verification.verifiedAt': { $ne: null },
    $or: [
      { 'verification.lastAttemptAt': null, 'verification.verifiedAt': { $lte: weekAgo } },
      { 'verification.consecutiveFailures': 0, 'verification.lastAttemptAt': { $lte: weekAgo } },
      {
        'verification.consecutiveFailures': { $gt: 0 },
        'verification.lastAttemptAt': { $lte: retryCutoff },
      },
    ],
  };
}

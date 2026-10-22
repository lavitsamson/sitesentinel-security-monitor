import { createHash, timingSafeEqual } from 'node:crypto';

const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest();

/**
 * Compares a presented credential with the expected one in constant time.
 * Hashing first gives both sides the same length, so neither the comparison
 * time nor an early length check reveals how long the secret is.
 */
export function constantTimeEqual(presented: string, expected: string): boolean {
  return timingSafeEqual(digest(presented), digest(expected));
}

/** True when an `Authorization` header carries exactly `Bearer <token>`. */
export function bearerTokenMatches(header: string | undefined, token: string): boolean {
  const match = /^Bearer (\S+)$/.exec(header ?? '');
  return match?.[1] !== undefined && constantTimeEqual(match[1], token);
}

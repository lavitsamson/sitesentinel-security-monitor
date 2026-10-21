import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Signatures older (or newer) than this are rejected by `verifyWebhookSignature`. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

/** A new signing secret for a webhook channel: 256 random bits. */
export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString('base64url')}`;
}

function hmac(secret: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

/**
 * The `X-SiteSentinel-Signature` value: `t=<unix seconds>,v1=<hex HMAC-SHA256>`
 * over `"<t>.<raw body>"`. Signing the timestamp lets receivers reject replays.
 */
export function signWebhook(secret: string, body: string, timestamp: number): string {
  return `t=${timestamp},v1=${hmac(secret, timestamp, body)}`;
}

/**
 * The receiver's side, as documented in the README: recompute the HMAC over the
 * raw body, compare in constant time, and refuse stale timestamps.
 */
export function verifyWebhookSignature(
  secret: string,
  body: string,
  header: string,
  nowSeconds: number,
  toleranceSeconds = SIGNATURE_TOLERANCE_SECONDS,
): boolean {
  const parts = new Map(
    header.split(',').map((part) => {
      const [key = '', ...value] = part.trim().split('=');
      return [key, value.join('=')] as const;
    }),
  );
  const timestamp = Number(parts.get('t'));
  const signature = parts.get('v1') ?? '';
  if (!Number.isInteger(timestamp) || Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
    return false;
  }
  const expected = Buffer.from(hmac(secret, timestamp, body), 'hex');
  const given = Buffer.from(signature, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

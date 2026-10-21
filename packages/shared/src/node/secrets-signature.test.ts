import { randomBytes } from 'node:crypto';
import { decryptSecret, encryptSecret, parseSecretKey } from './secrets.js';
import {
  SIGNATURE_TOLERANCE_SECONDS,
  generateWebhookSecret,
  signWebhook,
  verifyWebhookSignature,
} from './webhook-signature.js';

const key = randomBytes(32);

describe('parseSecretKey', () => {
  it('accepts base64 of 32 bytes', () => {
    expect(parseSecretKey(key.toString('base64'))).toEqual(key);
  });

  it.each(['', 'c2hvcnQ=', randomBytes(31).toString('base64')])('rejects %j', (value) => {
    expect(() => parseSecretKey(value)).toThrow(/32 bytes/);
  });
});

describe('encryptSecret / decryptSecret', () => {
  it('round-trips, with a fresh IV every time', () => {
    const a = encryptSecret('whsec_abc', key);
    const b = encryptSecret('whsec_abc', key);

    expect(a).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain('whsec_abc');
    expect(decryptSecret(a, key)).toBe('whsec_abc');
  });

  it('refuses a tampered ciphertext or the wrong key', () => {
    const payload = encryptSecret('whsec_abc', key);
    const [version, iv, tag, ciphertext = ''] = payload.split('.');
    const flipped = Buffer.from(ciphertext, 'base64url');
    flipped[0] = (flipped[0] ?? 0) ^ 1;

    expect(() =>
      decryptSecret([version, iv, tag, flipped.toString('base64url')].join('.'), key),
    ).toThrow();
    expect(() => decryptSecret(payload, randomBytes(32))).toThrow();
  });

  it.each(['', 'plain-text', 'v2.a.b.c', 'v1.a.b'])('rejects malformed payload %j', (value) => {
    expect(() => decryptSecret(value, key)).toThrow(/format/);
  });
});

describe('webhook signatures', () => {
  const secret = generateWebhookSecret();
  const body = JSON.stringify({ text: 'example.com is down' });
  const now = 1_790_000_000;

  it('generates distinct, prefixed secrets', () => {
    expect(secret).toMatch(/^whsec_[\w-]{43}$/);
    expect(generateWebhookSecret()).not.toBe(secret);
  });

  it('signs the timestamp and body, and the receiver can verify it', () => {
    const header = signWebhook(secret, body, now);

    expect(header).toMatch(new RegExp(`^t=${now},v1=[0-9a-f]{64}$`));
    expect(verifyWebhookSignature(secret, body, header, now + 10)).toBe(true);
  });

  it('rejects a changed body, the wrong secret, or a forged signature', () => {
    const header = signWebhook(secret, body, now);

    expect(verifyWebhookSignature(secret, `${body} `, header, now)).toBe(false);
    expect(verifyWebhookSignature(generateWebhookSecret(), body, header, now)).toBe(false);
    expect(verifyWebhookSignature(secret, body, `t=${now},v1=${'0'.repeat(64)}`, now)).toBe(false);
    expect(verifyWebhookSignature(secret, body, `t=${now},v1=abc`, now)).toBe(false);
  });

  it('rejects replays outside the tolerance window and missing timestamps', () => {
    const header = signWebhook(secret, body, now);

    expect(verifyWebhookSignature(secret, body, header, now + SIGNATURE_TOLERANCE_SECONDS)).toBe(
      true,
    );
    expect(
      verifyWebhookSignature(secret, body, header, now + SIGNATURE_TOLERANCE_SECONDS + 1),
    ).toBe(false);
    expect(verifyWebhookSignature(secret, body, header.replace(/^t=\d+,/, ''), now)).toBe(false);
  });
});

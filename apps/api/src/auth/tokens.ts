import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import type { Clock } from '@sitesentinel/checks';

const ISSUER = 'sitesentinel-api';
const AUDIENCE = 'sitesentinel-web';
const ALGORITHM = 'HS256';

export interface AccessTokens {
  sign(userId: string): Promise<string>;
  /** The user id for a valid, unexpired token; otherwise null. */
  verify(token: string): Promise<string | null>;
}

export function createAccessTokens(secret: string, ttlSeconds: number, clock: Clock): AccessTokens {
  const key = new TextEncoder().encode(secret);
  const nowSeconds = () => Math.floor(clock.now().getTime() / 1000);

  return {
    sign(userId) {
      const iat = nowSeconds();
      return new SignJWT({})
        .setProtectedHeader({ alg: ALGORITHM })
        .setSubject(userId)
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setIssuedAt(iat)
        .setExpirationTime(iat + ttlSeconds)
        .sign(key);
    },
    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, key, {
          issuer: ISSUER,
          audience: AUDIENCE,
          algorithms: [ALGORITHM], // never let the token choose (no `alg: none`)
          currentDate: clock.now(),
        });
        return payload.sub ?? null;
      } catch {
        return null;
      }
    },
  };
}

/** 256 bits of randomness, URL-safe. Used for refresh and password-reset tokens. */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Opaque tokens are stored as SHA-256 only. They are high-entropy random values,
 * so a fast hash is enough (unlike passwords): a database leak exposes no usable tokens.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

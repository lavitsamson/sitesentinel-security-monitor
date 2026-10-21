import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import type { Clock } from '@sitesentinel/checks';
import { RefreshTokenModel } from '@sitesentinel/db';
import { generateOpaqueToken, hashToken, type AccessTokens } from './tokens.js';

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
}

export type RefreshOutcome =
  | { ok: true; userId: string; tokens: SessionTokens }
  | { ok: false; reason: 'unknown' | 'expired' | 'reused' };

export interface SessionService {
  /** Starts a new token family (login, register). */
  start(userId: string): Promise<SessionTokens>;
  /** Rotates a refresh token. Reusing a rotated token revokes its whole family. */
  refresh(refreshToken: string): Promise<RefreshOutcome>;
  /** Ends the session the refresh token belongs to (logout). */
  end(refreshToken: string): Promise<void>;
  /** Ends every session of the user (password reset). */
  endAll(userId: string): Promise<void>;
}

export function createSessionService(deps: {
  accessTokens: AccessTokens;
  refreshTokenTtlDays: number;
  clock: Clock;
}): SessionService {
  const { accessTokens, refreshTokenTtlDays, clock } = deps;
  const ttlMs = refreshTokenTtlDays * 24 * 60 * 60 * 1000;

  async function issue(userId: string, familyId: string): Promise<SessionTokens> {
    const refreshToken = generateOpaqueToken();
    await RefreshTokenModel.create({
      userId: new Types.ObjectId(userId),
      tokenHash: hashToken(refreshToken),
      familyId,
      expiresAt: new Date(clock.now().getTime() + ttlMs),
    });
    return { accessToken: await accessTokens.sign(userId), refreshToken };
  }

  async function revokeFamily(familyId: string): Promise<void> {
    await RefreshTokenModel.updateMany(
      { familyId, revokedAt: null },
      { $set: { revokedAt: clock.now() } },
    );
  }

  return {
    start: (userId) => issue(userId, randomUUID()),

    async refresh(refreshToken) {
      const tokenHash = hashToken(refreshToken);
      const now = clock.now();
      // Atomic claim: of two concurrent refreshes with the same token, only one
      // matches `revokedAt: null`; the other is treated as reuse.
      const claimed = await RefreshTokenModel.findOneAndUpdate(
        { tokenHash, revokedAt: null, expiresAt: { $gt: now } },
        { $set: { revokedAt: now } },
      );
      if (claimed) {
        const userId = claimed.userId.toString();
        return { ok: true, userId, tokens: await issue(userId, claimed.familyId) };
      }

      const existing = await RefreshTokenModel.findOne({ tokenHash });
      if (!existing) return { ok: false, reason: 'unknown' };
      if (existing.revokedAt) {
        // A rotated token came back: it was stolen or replayed. Kill the family.
        await revokeFamily(existing.familyId);
        return { ok: false, reason: 'reused' };
      }
      return { ok: false, reason: 'expired' };
    },

    async end(refreshToken) {
      const existing = await RefreshTokenModel.findOne({ tokenHash: hashToken(refreshToken) });
      if (existing) await revokeFamily(existing.familyId);
    },

    async endAll(userId) {
      await RefreshTokenModel.updateMany(
        { userId: new Types.ObjectId(userId), revokedAt: null },
        { $set: { revokedAt: clock.now() } },
      );
    },
  };
}

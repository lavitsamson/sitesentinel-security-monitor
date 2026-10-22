import type { Clock } from '@sitesentinel/checks';
import type {
  PublicUser,
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  updateProfileSchema,
} from '@sitesentinel/shared';
import type { z } from 'zod';
import { UserModel, isDuplicateKeyError, recordAudit, toPublicUser } from '@sitesentinel/db';
import { HttpError } from '../http/errors.js';
import type { Logger } from '../logger.js';
import type { Mailer } from '../mail/mailer.js';
import type { PasswordHasher } from './passwords.js';
import type { SessionService, SessionTokens } from './sessions.js';
import { generateOpaqueToken, hashToken } from './tokens.js';

export interface AuthServiceDeps {
  passwords: PasswordHasher;
  sessions: SessionService;
  mailer: Mailer;
  clock: Clock;
  logger: Logger;
  /** Base URL of the web app, for links in emails. */
  webOrigin: string;
  passwordResetTtlMinutes: number;
}

export interface SignedIn {
  user: PublicUser;
  tokens: SessionTokens;
}

const INVALID_CREDENTIALS = new HttpError(401, 'Unauthorized', 'Invalid email or password');

const SIGNED_OUT = new HttpError(401, 'Unauthorized', 'Sign in to continue');

/** Who is acting on their own account, for the audit log. */
export interface AccountActor {
  userId: string;
  ip?: string | undefined;
}

export function createAuthService(deps: AuthServiceDeps) {
  const { passwords, sessions, mailer, clock, logger } = deps;

  return {
    async register(input: z.output<typeof registerSchema>): Promise<SignedIn> {
      try {
        const user = await UserModel.create({
          email: input.email,
          name: input.name,
          passwordHash: await passwords.hash(input.password),
        });
        return { user: toPublicUser(user), tokens: await sessions.start(user.id) };
      } catch (err) {
        if (isDuplicateKeyError(err)) {
          throw new HttpError(409, 'Conflict', 'An account with this email already exists');
        }
        throw err;
      }
    },

    async login(input: z.output<typeof loginSchema>): Promise<SignedIn> {
      const user = await UserModel.findOne({ email: input.email });
      // Verify even when the user doesn't exist, so timing doesn't reveal accounts.
      const ok = await passwords.verify(user?.passwordHash ?? null, input.password);
      if (!user || !ok) throw INVALID_CREDENTIALS;
      return { user: toPublicUser(user), tokens: await sessions.start(user.id) };
    },

    async me(userId: string): Promise<PublicUser> {
      const user = await UserModel.findById(userId);
      // The account was deleted while the access token was still valid.
      if (!user) throw SIGNED_OUT;
      return toPublicUser(user);
    },

    async updateProfile(
      actor: AccountActor,
      patch: z.output<typeof updateProfileSchema>,
    ): Promise<PublicUser> {
      const user = await UserModel.findById(actor.userId);
      if (!user) throw SIGNED_OUT;
      if (patch.name !== undefined) user.name = patch.name;
      if (patch.notificationPrefs) user.notificationPrefs = patch.notificationPrefs;
      await user.save();
      await recordAudit({
        ownerId: actor.userId,
        action: 'user.update',
        entityType: 'user',
        entityId: user.id,
        ip: actor.ip,
      });
      return toPublicUser(user);
    },

    /**
     * Needs the current password, so a stolen session alone can't take over the
     * account. Every session (including other devices) is ended and a fresh one
     * is returned for the caller.
     */
    async changePassword(
      actor: AccountActor,
      input: z.output<typeof changePasswordSchema>,
    ): Promise<SessionTokens> {
      const user = await UserModel.findById(actor.userId);
      if (!user) throw SIGNED_OUT;
      // 400, not 401: the session is fine, and a 401 would make the web client try a refresh.
      if (!(await passwords.verify(user.passwordHash, input.currentPassword))) {
        throw new HttpError(400, 'Bad Request', 'Your current password is incorrect', [
          { path: 'currentPassword', message: 'Incorrect password' },
        ]);
      }
      user.passwordHash = await passwords.hash(input.newPassword);
      await user.save();
      await sessions.endAll(user.id);
      await recordAudit({
        ownerId: actor.userId,
        action: 'user.password.change',
        entityType: 'user',
        entityId: user.id,
        ip: actor.ip,
      });
      return sessions.start(user.id);
    },

    /**
     * Always succeeds from the caller's point of view, so the endpoint can't be
     * used to discover which emails have accounts. The email is sent in the background.
     */
    async forgotPassword(input: z.output<typeof forgotPasswordSchema>): Promise<void> {
      const token = generateOpaqueToken();
      const expiresAt = new Date(clock.now().getTime() + deps.passwordResetTtlMinutes * 60_000);
      const user = await UserModel.findOneAndUpdate(
        { email: input.email },
        { $set: { passwordReset: { tokenHash: hashToken(token), expiresAt } } },
      );
      if (!user) return;

      const link = `${deps.webOrigin}/reset-password?token=${encodeURIComponent(token)}`;
      mailer
        .send({
          to: user.email,
          subject: 'Reset your SiteSentinel password',
          text: [
            `Hi ${user.name},`,
            '',
            'Someone (hopefully you) asked to reset your SiteSentinel password.',
            `Use this link within ${deps.passwordResetTtlMinutes} minutes:`,
            '',
            link,
            '',
            "If you didn't ask for this, you can ignore this email; your password stays the same.",
          ].join('\n'),
        })
        .catch((err: unknown) => logger.error({ err }, 'failed to send password reset email'));
    },

    /** Single use: the token is consumed atomically, and every existing session is ended. */
    async resetPassword(token: string, newPassword: string): Promise<void> {
      const passwordHash = await passwords.hash(newPassword);
      const now = clock.now();
      const user = await UserModel.findOneAndUpdate(
        { 'passwordReset.tokenHash': hashToken(token), 'passwordReset.expiresAt': { $gt: now } },
        { $set: { passwordHash, passwordReset: null } },
      );
      if (!user) {
        throw new HttpError(400, 'Bad Request', 'This reset link is invalid or has expired');
      }
      // Receiving the email proves the address is theirs.
      if (!user.emailVerifiedAt) {
        await UserModel.updateOne({ _id: user._id }, { $set: { emailVerifiedAt: now } });
      }
      await sessions.endAll(user.id);
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;

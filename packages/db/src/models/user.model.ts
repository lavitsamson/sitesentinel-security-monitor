import { Schema, model, type HydratedDocument } from 'mongoose';
import type { PublicUser } from '@sitesentinel/shared';

export interface User {
  /** Lowercased by the request schema before it gets here. */
  email: string;
  passwordHash: string;
  name: string;
  emailVerifiedAt: Date | null;
  notificationPrefs: { emailAlerts: boolean };
  /** Pending password reset: only the SHA-256 of the emailed token is stored. */
  passwordReset: { tokenHash: string; expiresAt: Date } | null;
  createdAt: Date;
  updatedAt: Date;
}

export type UserDocument = HydratedDocument<User>;

const userSchema = new Schema<User>(
  {
    email: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    name: { type: String, required: true },
    emailVerifiedAt: { type: Date, default: null },
    notificationPrefs: {
      emailAlerts: { type: Boolean, default: true },
    },
    passwordReset: {
      type: new Schema({ tokenHash: String, expiresAt: Date }, { _id: false }),
      default: null,
    },
  },
  { timestamps: true },
);
userSchema.index({ 'passwordReset.tokenHash': 1 }, { sparse: true });

export const UserModel = model<User>('User', userSchema);

/** The explicit response shape: hashes and reset state never leave the API. */
export function toPublicUser(user: UserDocument): PublicUser {
  return {
    id: user._id.toString(),
    email: user.email,
    name: user.name,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
    notificationPrefs: { emailAlerts: user.notificationPrefs.emailAlerts },
    createdAt: user.createdAt.toISOString(),
  };
}

import { Schema, model, type Types } from 'mongoose';

export interface RefreshToken {
  userId: Types.ObjectId;
  /** SHA-256 of the opaque token; the token itself only ever lives in the cookie. */
  tokenHash: string;
  /** Every token rotated from one login shares a family, so reuse can revoke them all. */
  familyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const refreshTokenSchema = new Schema<RefreshToken>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    familyId: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
// MongoDB deletes expired tokens itself.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshTokenModel = model<RefreshToken>('RefreshToken', refreshTokenSchema);

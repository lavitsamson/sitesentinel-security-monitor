import { z } from 'zod';

export const PASSWORD_MIN_LENGTH = 12;
/** argon2 cost is per byte, so cap input length to stop a cheap CPU-exhaustion request. */
export const PASSWORD_MAX_LENGTH = 128;

/** Trimmed and lowercased before format validation, so `" A@B.com"` is accepted. */
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters`);

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().min(1, 'Enter your name').max(100),
});
export type RegisterInput = z.input<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  // No strength rules on login: they only ever apply when a password is set.
  password: z.string().min(1, 'Enter your password').max(PASSWORD_MAX_LENGTH),
});
export type LoginInput = z.input<typeof loginSchema>;

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});
export type ForgotPasswordInput = z.input<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(1).max(200),
  password: passwordSchema,
});
export type ResetPasswordInput = z.input<typeof resetPasswordSchema>;

/** The only user shape the API ever returns: never hashes or tokens. */
export const publicUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  emailVerifiedAt: z.iso.datetime().nullable(),
  notificationPrefs: z.object({
    /** Off mutes alert emails on every EMAIL channel; webhooks are unaffected. */
    emailAlerts: z.boolean(),
  }),
  createdAt: z.iso.datetime(),
});
export type PublicUser = z.infer<typeof publicUserSchema>;

export const updateProfileSchema = z
  .strictObject({
    name: z.string().trim().min(1, 'Enter your name').max(100),
    notificationPrefs: z.strictObject({ emailAlerts: z.boolean() }),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, 'Provide at least one field to update');
export type UpdateProfileInput = z.input<typeof updateProfileSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password').max(PASSWORD_MAX_LENGTH),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.input<typeof changePasswordSchema>;

import {
  publicUserSchema,
  type ChangePasswordInput,
  type ForgotPasswordInput,
  type LoginInput,
  type PublicUser,
  type RegisterInput,
  type ResetPasswordInput,
  type UpdateProfileInput,
} from '@sitesentinel/shared';
import { apiRequest } from './client';

// Sign-in style calls never retry on 401: there a 401 means "wrong credentials",
// not "access token expired".
export const authApi = {
  me: (): Promise<PublicUser> => apiRequest('GET', '/auth/me', { schema: publicUserSchema }),

  login: (input: LoginInput): Promise<PublicUser> =>
    apiRequest('POST', '/auth/login', {
      body: input,
      schema: publicUserSchema,
      retryOnUnauthorized: false,
    }),

  register: (input: RegisterInput): Promise<PublicUser> =>
    apiRequest('POST', '/auth/register', {
      body: input,
      schema: publicUserSchema,
      retryOnUnauthorized: false,
    }),

  logout: (): Promise<void> => apiRequest('POST', '/auth/logout', { retryOnUnauthorized: false }),

  forgotPassword: (input: ForgotPasswordInput): Promise<void> =>
    apiRequest('POST', '/auth/forgot-password', { body: input, retryOnUnauthorized: false }),

  resetPassword: (input: ResetPasswordInput): Promise<void> =>
    apiRequest('POST', '/auth/reset-password', { body: input, retryOnUnauthorized: false }),

  updateProfile: (input: UpdateProfileInput): Promise<PublicUser> =>
    apiRequest('PATCH', '/auth/me', { body: input, schema: publicUserSchema }),

  // A wrong current password is a 400, so the usual refresh-on-401 retry is safe here.
  changePassword: (input: ChangePasswordInput): Promise<void> =>
    apiRequest('POST', '/auth/change-password', { body: input }),
};

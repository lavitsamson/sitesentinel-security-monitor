import type {
  ForgotPasswordInput,
  LoginInput,
  PublicUser,
  RegisterInput,
  ResetPasswordInput,
} from '@sitesentinel/shared';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { authApi } from '../api/auth';

export const useAuthStore = defineStore('auth', () => {
  const user = ref<PublicUser | null>(null);
  /** True once the initial session check has finished (signed in or not). */
  const ready = ref(false);
  const isAuthenticated = computed(() => user.value !== null);
  let sessionCheck: Promise<void> | null = null;

  /** Asks the API who is signed in. Runs once; later calls share the first result. */
  function loadSession(): Promise<void> {
    sessionCheck ??= authApi
      .me()
      .then((me) => {
        user.value = me;
      })
      .catch(() => {
        user.value = null;
      })
      .finally(() => {
        ready.value = true;
      });
    return sessionCheck;
  }

  async function login(input: LoginInput) {
    user.value = await authApi.login(input);
  }

  async function register(input: RegisterInput) {
    user.value = await authApi.register(input);
  }

  async function logout() {
    try {
      await authApi.logout();
    } finally {
      // Signed out locally even if the request failed; the cookies expire anyway.
      user.value = null;
    }
  }

  /** The session ended elsewhere (refresh failed). */
  function clearSession() {
    user.value = null;
  }

  const forgotPassword = (input: ForgotPasswordInput) => authApi.forgotPassword(input);
  const resetPassword = (input: ResetPasswordInput) => authApi.resetPassword(input);

  return {
    user,
    ready,
    isAuthenticated,
    loadSession,
    login,
    register,
    logout,
    clearSession,
    forgotPassword,
    resetPassword,
  };
});

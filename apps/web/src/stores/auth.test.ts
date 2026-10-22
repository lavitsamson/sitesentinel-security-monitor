import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authApi } from '../api/auth';
import { ApiError } from '../api/client';
import { makeUser } from '../test/fixtures';
import { useAuthStore } from './auth';

vi.mock('../api/auth', () => ({
  authApi: {
    me: vi.fn(),
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    forgotPassword: vi.fn(),
    resetPassword: vi.fn(),
    updateProfile: vi.fn(),
    changePassword: vi.fn(),
  },
}));
const api = vi.mocked(authApi);

const ada = makeUser();

describe('auth store', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setActivePinia(createPinia());
  });

  it('loads the current user once, however often it is asked', async () => {
    api.me.mockResolvedValue(ada);
    const auth = useAuthStore();

    await Promise.all([auth.loadSession(), auth.loadSession()]);

    expect(api.me).toHaveBeenCalledOnce();
    expect(auth).toMatchObject({ user: ada, ready: true, isAuthenticated: true });
  });

  it('treats a failed session check as signed out', async () => {
    api.me.mockRejectedValue(new ApiError(401));
    const auth = useAuthStore();

    await auth.loadSession();

    expect(auth).toMatchObject({ user: null, ready: true, isAuthenticated: false });
  });

  it('stores the user after login and register', async () => {
    api.login.mockResolvedValue(ada);
    api.register.mockResolvedValue({ ...ada, name: 'New' });
    const auth = useAuthStore();

    await auth.login({ email: ada.email, password: 'x' });
    expect(auth.user?.name).toBe('Ada');

    await auth.register({ email: ada.email, password: 'y', name: 'New' });
    expect(auth.user?.name).toBe('New');
  });

  it('leaves the user signed out when login fails', async () => {
    api.login.mockRejectedValue(new ApiError(401));
    const auth = useAuthStore();

    await expect(auth.login({ email: ada.email, password: 'x' })).rejects.toBeInstanceOf(ApiError);
    expect(auth.isAuthenticated).toBe(false);
  });

  it('signs out locally even if the logout request fails', async () => {
    api.login.mockResolvedValue(ada);
    api.logout.mockRejectedValue(new TypeError('Failed to fetch'));
    const auth = useAuthStore();
    await auth.login({ email: ada.email, password: 'x' });

    await auth.logout().catch(() => undefined);

    expect(auth.user).toBeNull();
  });

  it('keeps the signed-in user in step with profile changes', async () => {
    api.login.mockResolvedValue(ada);
    api.updateProfile.mockResolvedValue({ ...ada, notificationPrefs: { emailAlerts: false } });
    const auth = useAuthStore();
    await auth.login({ email: ada.email, password: 'x' });

    await auth.updateProfile({ notificationPrefs: { emailAlerts: false } });

    expect(auth.user?.notificationPrefs.emailAlerts).toBe(false);
  });
});

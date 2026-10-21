import type { LocationQueryValue, Router } from 'vue-router';
import { onSessionExpired } from '../api/client';
import { useAuthStore } from '../stores/auth';

/**
 * Where to go after signing in. Only same-app paths are accepted, so a crafted
 * `?redirect=https://evil.example` (or `//evil.example`) can't bounce users off-site.
 */
export function safeRedirect(value: LocationQueryValue | LocationQueryValue[] | undefined): string {
  const path = Array.isArray(value) ? value[0] : value;
  if (typeof path !== 'string' || !path.startsWith('/') || /^\/[/\\]/.test(path)) {
    return '/dashboard';
  }
  return path;
}

export function installAuthGuard(router: Router): void {
  router.beforeEach(async (to) => {
    const auth = useAuthStore();
    await auth.loadSession();
    if (to.meta.requiresAuth && !auth.isAuthenticated) {
      return { name: 'login', query: { redirect: to.fullPath } };
    }
    if (to.meta.guestOnly && auth.isAuthenticated) {
      return { name: 'dashboard' };
    }
    return true;
  });

  // A request found the session gone (refresh failed): sign out locally and,
  // if the current page needs a session, ask the user to sign in again.
  onSessionExpired(() => {
    const auth = useAuthStore();
    auth.clearSession();
    const current = router.currentRoute.value;
    if (auth.ready && current.meta.requiresAuth) {
      void router.push({
        name: 'login',
        query: { redirect: current.fullPath, expired: '1' },
      });
    }
  });
}

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { authApi } from '../api/auth';
import { ApiError } from '../api/client';
import { installAuthGuard, safeRedirect } from './guards';

vi.mock('../api/auth', () => ({ authApi: { me: vi.fn() } }));
const me = vi.mocked(authApi.me);

const Empty = { template: '<div />' };

function makeRouter() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: Empty },
      { path: '/login', name: 'login', component: Empty, meta: { guestOnly: true } },
      { path: '/dashboard', name: 'dashboard', component: Empty, meta: { requiresAuth: true } },
      { path: '/sites/:id', name: 'site', component: Empty, meta: { requiresAuth: true } },
    ],
  });
  installAuthGuard(router);
  return router;
}

describe('auth guard', () => {
  beforeEach(() => {
    me.mockReset();
    setActivePinia(createPinia());
  });

  it('sends signed-out users to sign in, remembering where they were going', async () => {
    me.mockRejectedValue(new ApiError(401));
    const router = makeRouter();

    await router.push('/sites/42?tab=runs');

    expect(router.currentRoute.value.name).toBe('login');
    expect(router.currentRoute.value.query.redirect).toBe('/sites/42?tab=runs');
  });

  it('lets signed-in users through and keeps them off guest-only pages', async () => {
    me.mockResolvedValue({
      id: '1',
      email: 'a@b.co',
      name: 'A',
      emailVerifiedAt: null,
      createdAt: '2026-10-21T00:00:00.000Z',
    });
    const router = makeRouter();

    await router.push('/dashboard');
    expect(router.currentRoute.value.name).toBe('dashboard');

    await router.push('/login');
    expect(router.currentRoute.value.name).toBe('dashboard');
  });

  it('leaves public pages public', async () => {
    me.mockRejectedValue(new ApiError(401));
    const router = makeRouter();

    await router.push('/');

    expect(router.currentRoute.value.name).toBe('home');
  });
});

describe('safeRedirect', () => {
  it.each([
    ['/sites/42?tab=runs', '/sites/42?tab=runs'],
    [undefined, '/dashboard'],
    [null, '/dashboard'],
    ['https://evil.example', '/dashboard'],
    ['//evil.example/path', '/dashboard'],
    ['/\\evil.example', '/dashboard'],
    ['javascript:alert(1)', '/dashboard'],
  ])('maps %j to %j', (input, expected) => {
    expect(safeRedirect(input)).toBe(expected);
  });
});

import { flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { authApi } from '../../api/auth';
import { ApiError } from '../../api/client';
import { mountWithVuetify } from '../../test/mount';
import LoginView from './LoginView.vue';

vi.mock('../../api/auth', () => ({ authApi: { login: vi.fn() } }));
const login = vi.mocked(authApi.login);

const Empty = { template: '<div />' };

async function mountLogin(path = '/login') {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/login', name: 'login', component: LoginView },
      { path: '/register', name: 'register', component: Empty },
      { path: '/forgot-password', name: 'forgot-password', component: Empty },
      { path: '/dashboard', name: 'dashboard', component: Empty },
      { path: '/sites', name: 'sites', component: Empty },
    ],
  });
  await router.push(path);
  const wrapper = mountWithVuetify(LoginView, { global: { plugins: [pinia, router] } });
  return { wrapper, router };
}

/** Lets the async validate-then-submit chain finish. */
async function settle() {
  await flushPromises();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await flushPromises();
}

async function fillAndSubmit(wrapper: Awaited<ReturnType<typeof mountLogin>>['wrapper']) {
  await wrapper.get('input[type="email"]').setValue('ada@example.com');
  await wrapper.get('input[autocomplete="current-password"]').setValue('correct horse battery');
  await wrapper.get('form').trigger('submit');
  await settle();
}

describe('LoginView', () => {
  beforeEach(() => {
    login.mockReset();
  });

  it('labels its fields for assistive technology', async () => {
    const { wrapper } = await mountLogin();

    expect(wrapper.findAll('label').map((l) => l.text())).toEqual(
      expect.arrayContaining(['Email', 'Password']),
    );
    expect(wrapper.find('button[aria-label="Show password"]').exists()).toBe(true);
  });

  it('shows validation errors and does not call the API for an empty form', async () => {
    const { wrapper } = await mountLogin();

    await wrapper.get('form').trigger('submit');
    await settle();

    expect(wrapper.text()).toContain('Enter your password');
    expect(login).not.toHaveBeenCalled();
  });

  it('signs in and goes to the requested page', async () => {
    login.mockResolvedValue({
      id: '1',
      email: 'ada@example.com',
      name: 'Ada',
      emailVerifiedAt: null,
      createdAt: '2026-10-21T00:00:00.000Z',
    });
    const { wrapper, router } = await mountLogin('/login?redirect=/sites');

    await fillAndSubmit(wrapper);

    expect(login).toHaveBeenCalledWith({
      email: 'ada@example.com',
      password: 'correct horse battery',
    });
    expect(router.currentRoute.value.path).toBe('/sites');
  });

  it('shows the API error when sign-in fails', async () => {
    login.mockRejectedValue(
      new ApiError(401, {
        type: 'about:blank',
        title: 'Unauthorized',
        status: 401,
        detail: 'Invalid email or password',
      }),
    );
    const { wrapper, router } = await mountLogin();

    await fillAndSubmit(wrapper);

    expect(wrapper.get('[data-test="error"]').text()).toBe('Invalid email or password');
    expect(router.currentRoute.value.name).toBe('login');
  });

  it('explains why the user was sent here after their session expired', async () => {
    const { wrapper } = await mountLogin('/login?expired=1');

    expect(wrapper.get('[data-test="notice"]').text()).toContain('session has expired');
  });
});

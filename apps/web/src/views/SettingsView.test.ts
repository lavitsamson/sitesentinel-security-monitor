import { flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { authApi } from '../api/auth';
import { ApiError } from '../api/client';
import { useAuthStore } from '../stores/auth';
import { makeUser } from '../test/fixtures';
import { mountWithVuetify } from '../test/mount';
import SettingsView from './SettingsView.vue';

vi.mock('../api/auth', () => ({
  authApi: { updateProfile: vi.fn(), changePassword: vi.fn() },
}));
const api = vi.mocked(authApi);

async function mountSettings() {
  const pinia = createPinia();
  setActivePinia(pinia);
  useAuthStore().user = makeUser();
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/alert-channels', name: 'alert-channels', component: { template: '<div />' } },
    ],
  });
  await router.push('/');
  const wrapper = mountWithVuetify(SettingsView, {
    global: { plugins: [pinia, router] },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
}

async function fill(wrapper: Awaited<ReturnType<typeof mountSettings>>, values: string[]) {
  const fields = ['current-password', 'new-password', 'confirm-password'];
  for (const [i, value] of values.entries()) {
    await wrapper.get(`[data-test="${fields[i]}"] input`).setValue(value);
  }
  await wrapper.get('[data-test="password-form"]').trigger('submit');
}

/** Validation is async and can take a while under load, so wait for its effect. */
async function waitForText(wrapper: Awaited<ReturnType<typeof mountSettings>>, text: string) {
  await vi.waitFor(() => expect(wrapper.text()).toContain(text));
}

describe('SettingsView', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('turns email alerts off', async () => {
    api.updateProfile.mockResolvedValue(makeUser({ notificationPrefs: { emailAlerts: false } }));
    const wrapper = await mountSettings();

    await wrapper.get('[data-test="email-alerts"] input').setValue(false);
    await flushPromises();

    expect(api.updateProfile).toHaveBeenCalledWith({ notificationPrefs: { emailAlerts: false } });
    expect(useAuthStore().user?.notificationPrefs.emailAlerts).toBe(false);
    wrapper.unmount();
  });

  it('saves a new name', async () => {
    api.updateProfile.mockResolvedValue(makeUser({ name: 'Ada Lovelace' }));
    const wrapper = await mountSettings();

    await wrapper.get('[data-test="profile-name"] input').setValue('Ada Lovelace');
    await wrapper.get('[data-test="profile-save"]').trigger('submit');
    await flushPromises();

    expect(api.updateProfile).toHaveBeenCalledWith({ name: 'Ada Lovelace' });
    wrapper.unmount();
  });

  it('checks the new passwords match before calling the API', async () => {
    const wrapper = await mountSettings();

    await fill(wrapper, ['old password!!', 'a brand new passphrase', 'something else']);
    await waitForText(wrapper, "The passwords don't match");

    expect(api.changePassword).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('changes the password and clears the form', async () => {
    api.changePassword.mockResolvedValue(undefined);
    const wrapper = await mountSettings();

    await fill(wrapper, ['old password!!', 'a brand new passphrase', 'a brand new passphrase']);
    await vi.waitFor(() => expect(api.changePassword).toHaveBeenCalled());
    await flushPromises();

    expect(api.changePassword).toHaveBeenCalledWith({
      currentPassword: 'old password!!',
      newPassword: 'a brand new passphrase',
    });
    expect(
      (wrapper.get('[data-test="current-password"] input').element as HTMLInputElement).value,
    ).toBe('');
    wrapper.unmount();
  });

  it('flags a wrong current password on its field', async () => {
    api.changePassword.mockRejectedValue(
      new ApiError(400, {
        type: 'about:blank',
        title: 'Bad Request',
        status: 400,
        detail: 'Your current password is incorrect',
        errors: [{ path: 'currentPassword', message: 'Incorrect password' }],
      }),
    );
    const wrapper = await mountSettings();

    await fill(wrapper, ['wrong password', 'a brand new passphrase', 'a brand new passphrase']);
    await waitForText(wrapper, 'Your current password is incorrect');

    expect(wrapper.get('[data-test="current-password"]').text()).toContain(
      'Your current password is incorrect',
    );
    wrapper.unmount();
  });
});

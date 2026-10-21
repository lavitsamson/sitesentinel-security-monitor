import { flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { ApiError } from '../../api/client';
import { sitesApi } from '../../api/sites';
import { makeSite } from '../../test/fixtures';
import { mountWithVuetify } from '../../test/mount';
import AddSiteView from './AddSiteView.vue';

vi.mock('../../api/sites', () => ({
  sitesApi: { create: vi.fn(), verify: vi.fn(), get: vi.fn() },
}));
const api = vi.mocked(sitesApi);

const Empty = { template: '<div />' };
const unverified = makeSite({
  id: 'site1',
  domain: 'shop.example.com',
  verification: { method: null, token: 'tok123', verifiedAt: null },
  currentGrade: null,
  currentScore: null,
});

async function mountWizard(path = '/sites/new') {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/sites', name: 'sites', component: Empty },
      { path: '/sites/new', name: 'site-new', component: AddSiteView },
      { path: '/sites/:id/setup', name: 'site-setup', component: AddSiteView, props: true },
      { path: '/sites/:id', name: 'site', component: Empty },
    ],
  });
  await router.push(path);
  const id = router.currentRoute.value.params.id;
  const wrapper = mountWithVuetify(AddSiteView, {
    props: typeof id === 'string' ? { id } : {},
    global: { plugins: [pinia, router] },
  });
  await flushPromises();
  return wrapper;
}

/** Validation is async; wait for the submit to settle. */
async function settle() {
  await flushPromises();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await flushPromises();
}

type Wrapper = Awaited<ReturnType<typeof mountWizard>>;

async function enterDomain(wrapper: Wrapper, domain: string) {
  await wrapper.get('[data-test="domain"] input').setValue(domain);
  await wrapper.get('[data-test="step-domain"] form').trigger('submit');
  await settle();
}

describe('AddSiteView', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('rejects an IP address or private name without calling the API', async () => {
    const wrapper = await mountWizard();

    await enterDomain(wrapper, '127.0.0.1');
    expect(wrapper.text()).toContain('IP addresses cannot be monitored');

    await enterDomain(wrapper, 'printer.local');
    expect(wrapper.text()).toContain('Private or reserved domains cannot be monitored');
    expect(api.create).not.toHaveBeenCalled();
  });

  it('creates the site from a pasted URL, then offers both verification methods', async () => {
    api.create.mockResolvedValue(unverified);
    const wrapper = await mountWizard();

    await enterDomain(wrapper, 'https://Shop.Example.com/');
    await vi.waitFor(() => expect(api.create).toHaveBeenCalled());
    await settle();

    expect(api.create).toHaveBeenCalledWith({
      domain: 'shop.example.com',
      checkIntervalMinutes: 60,
    });
    expect(wrapper.find('[data-test="step-method"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('DNS TXT record');
    expect(wrapper.text()).toContain('File on your website');
  });

  it('shows the API error when the domain is already monitored', async () => {
    api.create.mockRejectedValue(
      new ApiError(409, {
        type: 'about:blank',
        title: 'Conflict',
        status: 409,
        detail: 'You are already monitoring shop.example.com',
      }),
    );
    const wrapper = await mountWizard();

    await enterDomain(wrapper, 'shop.example.com');
    await vi.waitFor(() => expect(api.create).toHaveBeenCalled());
    await settle();

    expect(wrapper.text()).toContain('You are already monitoring shop.example.com');
    expect(wrapper.find('[data-test="step-domain"]').exists()).toBe(true);
  });

  it('shows the exact TXT record to add and explains why verification failed', async () => {
    api.get.mockResolvedValue(unverified);
    api.verify.mockRejectedValue(
      new ApiError(
        422,
        {
          type: 'about:blank',
          title: 'Unprocessable Content',
          status: 422,
          detail: 'Could not verify ownership of shop.example.com',
        },
        { attempts: [{ method: 'DNS_TXT', ok: false, detail: 'No matching TXT record found' }] },
      ),
    );
    const wrapper = await mountWizard('/sites/site1/setup');

    await wrapper.get('[data-test="choose-method"]').trigger('click');
    const txt = wrapper.get('[data-test="step-verify"] input');
    expect((txt.element as HTMLInputElement).value).toBe('sitesentinel-verify=tok123');

    await wrapper.get('[data-test="verify"]').trigger('click');
    await settle();

    expect(api.verify).toHaveBeenCalledWith('site1', 'DNS_TXT');
    expect(wrapper.get('[data-test="verify-error"]').text()).toContain(
      'Could not verify ownership of shop.example.com',
    );
    expect(wrapper.get('[data-test="attempts"]').text()).toBe(
      'DNS TXT record: No matching TXT record found',
    );
  });

  it('shows the file to publish for the file method and finishes on success', async () => {
    api.get.mockResolvedValue(unverified);
    api.verify.mockResolvedValue({
      ...unverified,
      verification: {
        method: 'WELL_KNOWN_FILE',
        token: 'tok123',
        verifiedAt: '2026-10-21T00:00:00.000Z',
      },
    });
    const wrapper = await mountWizard('/sites/site1/setup');

    await wrapper.get('input[value="WELL_KNOWN_FILE"]').setValue(true);
    await wrapper.get('[data-test="choose-method"]').trigger('click');
    const values = wrapper
      .findAll('[data-test="step-verify"] input')
      .map((i) => (i.element as HTMLInputElement).value);
    expect(values).toEqual([
      'https://shop.example.com/.well-known/sitesentinel-verify.txt',
      'tok123',
    ]);

    await wrapper.get('[data-test="verify"]').trigger('click');
    await settle();

    expect(api.verify).toHaveBeenCalledWith('site1', 'WELL_KNOWN_FILE');
    expect(wrapper.get('[data-test="done"]').text()).toContain('shop.example.com is verified');
  });

  it('skips straight to done when resuming an already verified site', async () => {
    api.get.mockResolvedValue(makeSite({ id: 'site1' }));
    const wrapper = await mountWizard('/sites/site1/setup');

    expect(wrapper.find('[data-test="done"]').exists()).toBe(true);
  });
});

import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client';
import { makeAlertChannel } from '../../test/fixtures';
import { mountWithVuetify } from '../../test/mount';
import AlertChannelDialog from './AlertChannelDialog.vue';

/** Dialogs teleport to <body>, so look them up there. */
const inBody = (selector: string) => document.body.querySelector<HTMLElement>(selector);

function mountDialog(props: Partial<InstanceType<typeof AlertChannelDialog>['$props']> = {}) {
  const save = vi.fn().mockResolvedValue(undefined);
  const wrapper = mountWithVuetify(AlertChannelDialog, {
    props: { modelValue: true, save, ...props },
    attachTo: document.body,
  });
  return { wrapper, save };
}

async function type(selector: string, value: string) {
  const input = inBody(`${selector} input`) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input'));
  await flushPromises();
}

async function submit() {
  inBody('[data-test="channel-save"]')?.click();
  await flushPromises();
}

describe('AlertChannelDialog', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('adds an email channel with a normalised address', async () => {
    const { wrapper, save } = mountDialog();
    await flushPromises();

    await type('[data-test="channel-name"]', 'On-call');
    await type('[data-test="channel-target"]', ' OnCall@Example.com ');
    await submit();

    expect(save).toHaveBeenCalledWith({
      type: 'EMAIL',
      name: 'On-call',
      target: 'oncall@example.com',
    });
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]]);
    wrapper.unmount();
  });

  it('shows field errors instead of saving an invalid webhook', async () => {
    const { wrapper, save } = mountDialog();
    await flushPromises();

    (inBody('[data-test="channel-type"] input[value="WEBHOOK"]') as HTMLInputElement).click();
    await flushPromises();
    await type('[data-test="channel-target"]', 'http://hooks.example.com/x');
    await submit();

    expect(save).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Enter a name');
    expect(document.body.textContent).toContain('Use an https:// URL on the default port');
    wrapper.unmount();
  });

  it("puts the API's refusal of an internal webhook host on the URL field", async () => {
    const save = vi.fn().mockRejectedValue(
      new ApiError(400, {
        type: 'about:blank',
        title: 'Bad Request',
        status: 400,
        detail: 'Webhook URLs must point to a public internet host',
        errors: [{ path: 'target', message: 'Use a public https:// URL' }],
      }),
    );
    const { wrapper } = mountDialog({
      save,
      channel: makeAlertChannel({ type: 'WEBHOOK', target: 'https://hooks.example.com/x' }),
    });
    await flushPromises();

    await type('[data-test="channel-target"]', 'https://localhost/x');
    await submit();

    expect(inBody('[data-test="channel-target"]')?.textContent).toContain(
      'must point to a public internet host',
    );
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    wrapper.unmount();
  });

  it('edits a channel without offering to change its type', async () => {
    const channel = makeAlertChannel({ name: 'Old name' });
    const { wrapper, save } = mountDialog({ channel });
    await flushPromises();

    expect(inBody('[data-test="channel-type"]')).toBeNull();
    await type('[data-test="channel-name"]', 'New name');
    await submit();

    expect(save).toHaveBeenCalledWith({ type: 'EMAIL', name: 'New name', target: channel.target });
    wrapper.unmount();
  });
});

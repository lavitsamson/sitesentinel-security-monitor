import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { mountWithVuetify } from '../../test/mount';
import BulkActionsBar from './BulkActionsBar.vue';

/** Dialogs teleport to <body>, so look them up there. */
const inBody = (selector: string) => document.body.querySelector<HTMLElement>(selector);

function mountBar() {
  return mountWithVuetify(BulkActionsBar, { props: { count: 3 }, attachTo: document.body });
}

describe('BulkActionsBar', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('shows how many sites are selected', () => {
    const wrapper = mountBar();

    expect(wrapper.get('[data-test="bulk-count"]').text()).toBe('3 sites selected');
    wrapper.unmount();
  });

  it.each(['CHECK_NOW', 'PAUSE', 'RESUME'] as const)('emits %s straight away', async (action) => {
    const wrapper = mountBar();

    await wrapper.get(`[data-test="bulk-${action}"]`).trigger('click');

    expect(wrapper.emitted('run')).toEqual([[{ action }]]);
    wrapper.unmount();
  });

  it('asks for confirmation before deleting', async () => {
    const wrapper = mountBar();

    await wrapper.get('[data-test="bulk-DELETE"]').trigger('click');
    await flushPromises();
    expect(wrapper.emitted('run')).toBeUndefined();

    inBody('[data-test="bulk-delete-confirm"]')?.click();
    await flushPromises();

    expect(wrapper.emitted('run')).toEqual([[{ action: 'DELETE' }]]);
    wrapper.unmount();
  });

  it('validates and normalises the tag before emitting ADD_TAG', async () => {
    const wrapper = mountBar();
    await wrapper.get('[data-test="bulk-ADD_TAG"]').trigger('click');
    await flushPromises();
    const input = () => inBody('[data-test="bulk-tag-input"] input') as HTMLInputElement;
    const submit = async (value: string) => {
      input().value = value;
      input().dispatchEvent(new Event('input'));
      await flushPromises();
      inBody('[data-test="bulk-tag-submit"]')?.click();
      await flushPromises();
    };

    await submit('not ok!');
    expect(wrapper.emitted('run')).toBeUndefined();
    expect(document.body.textContent).toContain('Use letters, digits, - and _ only');

    await submit('  Shop ');
    expect(wrapper.emitted('run')).toEqual([[{ action: 'ADD_TAG', tag: 'shop' }]]);
    wrapper.unmount();
  });
});

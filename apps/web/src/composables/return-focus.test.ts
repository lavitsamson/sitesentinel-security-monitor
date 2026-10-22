import { describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { useReturnFocus } from './return-focus';

function setup() {
  const open = ref(false);
  const wrapper = mount(
    defineComponent({
      setup() {
        useReturnFocus(open);
        return () => h('div', [h('button', { id: 'opener' }), h('input', { id: 'inside' })]);
      },
    }),
    { attachTo: document.body },
  );
  const opener = wrapper.get('#opener').element as HTMLButtonElement;
  const inside = wrapper.get('#inside').element as HTMLInputElement;
  return { open, wrapper, opener, inside };
}

async function settle() {
  await nextTick();
  await nextTick();
}

describe('useReturnFocus', () => {
  it('focuses the opener again when the dialog closes', async () => {
    const { open, wrapper, opener, inside } = setup();
    opener.focus();
    open.value = true;
    await settle();
    inside.focus();

    open.value = false;
    await settle();

    expect(document.activeElement).toBe(opener);
    wrapper.unmount();
  });

  it('leaves focus alone when the opener has been removed', async () => {
    const { open, wrapper, opener, inside } = setup();
    opener.focus();
    open.value = true;
    await settle();
    inside.focus();
    opener.remove();

    open.value = false;
    await settle();

    expect(document.activeElement).toBe(inside);
    wrapper.unmount();
  });
});

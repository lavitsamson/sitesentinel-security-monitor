import { nextTick, watch, type WatchSource } from 'vue';

/**
 * Gives focus back to whatever had it when a dialog opened, once it closes.
 * Vuetify only does this for dialogs with an activator slot; ours are opened
 * from state (v-model), so keyboard users would otherwise land on <body>.
 */
export function useReturnFocus(open: WatchSource<boolean>): void {
  let previous: HTMLElement | null = null;

  watch(open, async (isOpen) => {
    if (isOpen) {
      previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      return;
    }
    const target = previous;
    previous = null;
    await nextTick();
    // The opener may be gone (e.g. its row was deleted); then leave focus alone.
    if (target?.isConnected) target.focus({ preventScroll: true });
  });
}

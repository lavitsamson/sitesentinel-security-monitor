import { mount, type ComponentMountingOptions } from '@vue/test-utils';
import { createVuetify } from 'vuetify';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';
import type { Component } from 'vue';

/** Mounts a component with a real Vuetify instance, as the app does. */
export function mountWithVuetify<T extends Component>(
  component: T,
  options: ComponentMountingOptions<T> = {},
) {
  const vuetify = createVuetify({ components, directives });
  return mount(component, {
    ...options,
    global: { ...options.global, plugins: [vuetify, ...(options.global?.plugins ?? [])] },
  });
}

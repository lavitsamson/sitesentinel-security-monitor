import '@mdi/font/css/materialdesignicons.css';
import 'vuetify/styles';
import { createPinia } from 'pinia';
import { createApp } from 'vue';
import App from './App.vue';
import { vuetify } from './plugins/vuetify';
import { router } from './router';

createApp(App).use(createPinia()).use(router).use(vuetify).mount('#app');

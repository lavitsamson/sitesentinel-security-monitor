import { createRouter, createWebHistory } from 'vue-router';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('../views/HomeView.vue'),
      meta: { title: 'SiteSentinel' },
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('../views/NotFoundView.vue'),
      meta: { title: 'Page not found' },
    },
  ],
});

router.afterEach((to) => {
  document.title = typeof to.meta.title === 'string' ? to.meta.title : 'SiteSentinel';
});

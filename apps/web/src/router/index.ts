import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { installAuthGuard } from './guards';

declare module 'vue-router' {
  interface RouteMeta {
    title?: string;
    /** Only for signed-in users; others are sent to sign in. */
    requiresAuth?: boolean;
    /** Only for signed-out users (sign in, register); others go to the dashboard. */
    guestOnly?: boolean;
  }
}

export const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: () => import('../views/HomeView.vue'),
    meta: { title: 'SiteSentinel' },
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('../views/auth/LoginView.vue'),
    meta: { title: 'Sign in · SiteSentinel', guestOnly: true },
  },
  {
    path: '/register',
    name: 'register',
    component: () => import('../views/auth/RegisterView.vue'),
    meta: { title: 'Create account · SiteSentinel', guestOnly: true },
  },
  {
    path: '/forgot-password',
    name: 'forgot-password',
    component: () => import('../views/auth/ForgotPasswordView.vue'),
    meta: { title: 'Forgot password · SiteSentinel', guestOnly: true },
  },
  {
    path: '/reset-password',
    name: 'reset-password',
    component: () => import('../views/auth/ResetPasswordView.vue'),
    meta: { title: 'Reset password · SiteSentinel' },
  },
  {
    path: '/dashboard',
    name: 'dashboard',
    component: () => import('../views/DashboardView.vue'),
    meta: { title: 'Dashboard · SiteSentinel', requiresAuth: true },
  },
  {
    path: '/sites',
    name: 'sites',
    component: () => import('../views/sites/SitesView.vue'),
    meta: { title: 'Sites · SiteSentinel', requiresAuth: true },
  },
  {
    path: '/sites/new',
    name: 'site-new',
    component: () => import('../views/sites/AddSiteView.vue'),
    meta: { title: 'Add site · SiteSentinel', requiresAuth: true },
  },
  {
    // Resumes the wizard at the verification step for a site that was added earlier.
    path: '/sites/:id/setup',
    name: 'site-setup',
    component: () => import('../views/sites/AddSiteView.vue'),
    props: true,
    meta: { title: 'Verify site · SiteSentinel', requiresAuth: true },
  },
  {
    path: '/sites/:id',
    name: 'site',
    component: () => import('../views/sites/SiteDetailView.vue'),
    props: true,
    meta: { title: 'Site · SiteSentinel', requiresAuth: true },
  },
  {
    path: '/incidents',
    name: 'incidents',
    component: () => import('../views/IncidentsView.vue'),
    meta: { title: 'Incidents · SiteSentinel', requiresAuth: true },
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('../views/NotFoundView.vue'),
    meta: { title: 'Page not found' },
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

installAuthGuard(router);

router.afterEach((to) => {
  document.title = to.meta.title ?? 'SiteSentinel';
});

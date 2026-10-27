import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { SESSION } from './sign-in.js';

// README screenshots of the seeded demo account (see screenshots.config.ts).
const OUT = fileURLToPath(new URL('../../docs/images/', import.meta.url));

test.use({ storageState: SESSION });

async function useTheme(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript((value) => {
    localStorage.setItem('sitesentinel.theme', value);
  }, theme);
}

/** Waits for data and for Chart.js to finish its entry animation, then captures. */
async function capture(page: Page, name: string) {
  await page.waitForLoadState('networkidle');
  await expect(page.locator('.v-progress-linear--active, .v-skeleton-loader')).toHaveCount(0);
  await page.waitForTimeout(1_200);
  await page.screenshot({ path: `${OUT}${name}.png` });
}

for (const theme of ['light', 'dark'] as const) {
  test(`dashboard (${theme})`, async ({ page }) => {
    await useTheme(page, theme);
    await page.goto('/dashboard');
    await capture(page, `dashboard-${theme}`);
  });
}

test('sites', async ({ page }) => {
  await page.goto('/sites');
  await expect(page.getByRole('link', { name: /\./ }).first()).toBeVisible();
  await capture(page, 'sites');
});

test('site detail', async ({ page }) => {
  // A site with findings to show, not a perfect score.
  const res = await page.request.get('/api/v1/sites?limit=100&sort=name');
  const { data } = (await res.json()) as { data: { id: string; currentGrade: string }[] };
  const site = data.find((s) => s.currentGrade === 'B') ?? data[0];
  expect(site, 'a seeded site').toBeDefined();
  await page.goto(`/sites/${site?.id}`);
  await expect(page.getByTestId('grade').first()).toBeVisible();
  await capture(page, 'site-detail');
});

test('add site', async ({ page }) => {
  await page.goto('/sites/new');
  await page.getByLabel('Domain').fill('shop.example.com');
  await capture(page, 'add-site');
});

test('incidents', async ({ page }) => {
  await page.goto('/incidents');
  await capture(page, 'incidents');
});

test('alert channels', async ({ page }) => {
  await page.goto('/alert-channels');
  await capture(page, 'alert-channels');
});

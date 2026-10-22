import type { Page } from '@playwright/test';
import { expectAccessible } from '../support/axe.js';
import { expect, test } from '../support/fixtures.js';

// Automated WCAG 2.2 AA scan of every page, in both themes (contrast differs).
// axe catches roughly a third of issues; keyboard.spec.ts covers focus and
// keyboard operation, which it can't judge.

const THEMES = ['light', 'dark'] as const;

async function useTheme(page: Page, theme: (typeof THEMES)[number]) {
  await page.addInitScript((value) => {
    localStorage.setItem('sitesentinel.theme', value);
  }, theme);
}

/** Opens a page and waits until it has rendered its content, not a skeleton. */
async function open(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await expect(page.locator('.v-skeleton-loader')).toHaveCount(0);
}

for (const theme of THEMES) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page }) => useTheme(page, theme));

    test('signed-out pages', async ({ page }) => {
      for (const path of ['/', '/login', '/register', '/forgot-password', '/does-not-exist']) {
        await open(page, path);
        await expectAccessible(page, `${theme} ${path}`);
      }
    });

    test('signed-in pages', async ({ page, account, api }) => {
      test.setTimeout(90_000);
      void account; // signed in
      const site = await api.addVerifiedSite();
      await api.checkAndWaitForGrade(site);

      const paths = [
        '/dashboard',
        '/sites',
        '/sites/new',
        `/sites/${site.id}`,
        '/incidents',
        '/alert-channels',
        '/settings',
      ];
      for (const path of paths) {
        await open(page, path);
        await expectAccessible(page, `${theme} ${path}`);
      }
    });

    test('dialogs and menus', async ({ page, account }) => {
      void account;
      await open(page, '/alert-channels');
      await page.getByTestId('add-channel').click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expectAccessible(page, `${theme} add alert channel dialog`);
      await page.keyboard.press('Escape');

      await page.getByTestId('user-menu').click();
      await expect(page.getByTestId('sign-out')).toBeVisible();
      await expectAccessible(page, `${theme} user menu`);
    });
  });
}

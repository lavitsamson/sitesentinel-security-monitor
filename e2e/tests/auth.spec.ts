import type { Page } from '@playwright/test';
import { apiClient, expect, newAccount, test, type Account } from '../support/fixtures.js';
import { resetRateLimits } from '../support/redis.js';

test.describe('signing in and out', () => {
  let account: Account;

  // Registered through a separate request context, so the page starts signed out.
  test.beforeEach(async ({ playwright, baseURL }) => {
    account = newAccount();
    const request = await playwright.request.newContext({ baseURL });
    await apiClient(request).register(account);
    await request.dispose();
    await resetRateLimits('login');
  });

  async function signIn(page: Page, password = account.password) {
    await page.getByLabel('Email').fill(account.email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
  }

  test('a signed-out visitor is sent to sign in, then back where they were going', async ({
    page,
  }) => {
    await page.goto('/incidents');
    await expect(page).toHaveURL(/\/login\?redirect=(%2F|\/)incidents$/);

    await signIn(page);
    await expect(page).toHaveURL(/\/incidents$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Incidents');
  });

  test('a wrong password is refused without saying which part was wrong', async ({ page }) => {
    await page.goto('/login');
    await signIn(page, 'not the right password');

    await expect(page.getByTestId('error')).toHaveText(/invalid email or password/i);
    await expect(page).toHaveURL(/\/login$/);
  });

  test('the session survives a reload and ends on sign out', async ({ page }) => {
    await page.goto('/login');
    await signIn(page);
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.reload();
    await expect(page.getByTestId('user-menu')).toContainText(account.name);

    await page.getByTestId('user-menu').click();
    await page.getByTestId('sign-out').click();
    await expect(page).toHaveURL(/\/$/);

    await page.goto('/sites');
    await expect(page).toHaveURL(/\/login/);
  });
});

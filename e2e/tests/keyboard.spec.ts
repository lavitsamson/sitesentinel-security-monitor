import type { Page } from '@playwright/test';
import { apiClient, expect, newAccount, test } from '../support/fixtures.js';
import { resetRateLimits } from '../support/redis.js';

/** Presses Tab until `target` has focus, failing after `max` presses. */
async function tabTo(page: Page, target: ReturnType<Page['locator']>, max = 30) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error(`Could not reach ${String(target)} with Tab`);
}

test('signing in works with the keyboard alone', async ({ page, playwright, baseURL }) => {
  const account = newAccount();
  const request = await playwright.request.newContext({ baseURL });
  await apiClient(request).register(account);
  await request.dispose();
  await resetRateLimits('login');

  await page.goto('/login');
  // The email field has focus on arrival.
  await expect(page.getByLabel('Email')).toBeFocused();
  await page.keyboard.type(account.email);
  await tabTo(page, page.getByLabel('Password', { exact: true }));
  await page.keyboard.type(account.password);
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(/\/dashboard$/);
});

test.describe('signed in', () => {
  test.beforeEach(async ({ page, account }) => {
    void account;
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('the skip link is the first stop and moves focus to the content', async ({ page }) => {
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();

    await page.keyboard.press('Enter');
    await expect(page.locator('#main')).toBeFocused();
  });

  test('every main navigation entry is reachable with Tab', async ({ page }) => {
    const nav = page.getByRole('navigation', { name: 'Main' });
    for (const name of ['Sites', 'Incidents', 'Alert channels', 'Settings']) {
      await tabTo(page, nav.getByRole('link', { name, exact: true }));
      await page.keyboard.press('Enter');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
    }
  });

  test('focus is visible on interactive elements', async ({ page }) => {
    const addSite = page.getByRole('link', { name: 'Add site' }).first();
    await tabTo(page, addSite);
    // A focus ring is an outline or a box-shadow, depending on the component.
    const indicator = await addSite.evaluate((el) => {
      const style = getComputedStyle(el);
      const overlay = el.querySelector('.v-btn__overlay');
      const overlayOpacity = overlay ? Number(getComputedStyle(overlay).opacity) : 0;
      return { outline: style.outlineStyle, shadow: style.boxShadow, overlayOpacity };
    });
    expect(
      indicator.outline !== 'none' || indicator.shadow !== 'none' || indicator.overlayOpacity > 0,
    ).toBe(true);
  });

  test('dialogs trap focus, close on Escape and give focus back', async ({ page }) => {
    await page.goto('/alert-channels');
    const add = page.getByTestId('add-channel');
    await tabTo(page, add);
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(add).toBeFocused();
  });

  test('on a phone the navigation opens from the menu button', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const menu = page.getByRole('button', { name: 'Open navigation' });
    await expect(menu).toHaveAttribute('aria-expanded', 'false');

    await menu.click();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Incidents', exact: true })
      .click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Incidents');
    // No horizontal scrolling at phone width.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

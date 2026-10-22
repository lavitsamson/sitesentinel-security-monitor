import { apiClient, expect, newAccount, test } from '../support/fixtures.js';

test("one user cannot see another user's site", async ({ page, api, account, browser }) => {
  void account; // owner, signed in on `page`
  const site = await api.addVerifiedSite();
  await page.goto(`/sites/${site.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(site.domain);

  const otherContext = await browser.newContext();
  try {
    const otherPage = await otherContext.newPage();
    await apiClient(otherPage.request).register(newAccount());

    // Same 404 as a site that never existed: existence doesn't leak.
    const res = await otherPage.request.get(`/api/v1/sites/${site.id}`);
    expect(res.status()).toBe(404);

    await otherPage.goto(`/sites/${site.id}`);
    await expect(otherPage.getByTestId('not-found')).toContainText('Site not found');
    await otherPage.goto('/sites');
    await expect(otherPage.getByTestId('sites-table')).not.toContainText(site.domain);
  } finally {
    await otherContext.close();
  }
});

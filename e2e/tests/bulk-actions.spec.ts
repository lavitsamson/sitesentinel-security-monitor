import { expect, navigate, test, uniqueDomain } from '../support/fixtures.js';

test('bulk actions pause, tag and delete the selected sites', async ({ page, account, api }) => {
  void account; // signed in
  const [first, second, third] = await Promise.all(
    ['alpha', 'bravo', 'charlie'].map((name) => api.addVerifiedSite(uniqueDomain(name))),
  );
  if (!first || !second || !third) throw new Error('sites not created');

  await page.goto('/dashboard');
  await navigate(page, 'Sites');
  const table = page.getByTestId('sites-table');
  const row = (domain: string) => table.getByRole('row').filter({ hasText: domain });
  await expect(row(third.domain)).toBeVisible();

  await row(first.domain).getByRole('checkbox').check();
  await row(second.domain).getByRole('checkbox').check();
  await expect(page.getByTestId('bulk-count')).toHaveText(/2 sites selected/);

  await test.step('pause', async () => {
    await page.getByTestId('bulk-PAUSE').click();
    await expect(page.getByTestId('snackbar')).toContainText(/paused 2/i);
    await expect(row(first.domain)).toContainText('Paused');
    await expect(row(second.domain)).toContainText('Paused');
    await expect(row(third.domain)).not.toContainText('Paused');
  });

  await test.step('tag', async () => {
    await row(first.domain).getByRole('checkbox').check();
    await row(second.domain).getByRole('checkbox').check();
    await page.getByTestId('bulk-ADD_TAG').click();
    await page.getByTestId('bulk-tag-input').getByRole('textbox').fill('client-a');
    await page.getByTestId('bulk-tag-submit').click();
    await expect(row(first.domain)).toContainText('client-a');
    await expect(row(second.domain)).toContainText('client-a');
  });

  await test.step('delete, after confirming', async () => {
    await row(first.domain).getByRole('checkbox').check();
    await row(second.domain).getByRole('checkbox').check();
    await page.getByTestId('bulk-DELETE').click();
    await page.getByTestId('bulk-delete-confirm').click();
    await expect(row(first.domain)).toHaveCount(0);
    await expect(row(second.domain)).toHaveCount(0);
    await expect(row(third.domain)).toBeVisible();
  });
});

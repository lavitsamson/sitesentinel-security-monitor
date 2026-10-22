import { expect, navigate, newAccount, test, uniqueDomain } from '../support/fixtures.js';
import { expectEmail } from '../support/mailpit.js';
import {
  breakSite,
  publishTxtRecord,
  resetRateLimits,
  skipCheckNowWindow,
} from '../support/redis.js';

// The core journey from CLAUDE.md §12: register → add site → verify → run checks
// → see grade → create alert channel → force failure → incident appears.
test('a new user monitors a site and is alerted when it breaks', async ({ page }) => {
  test.setTimeout(120_000);
  const account = newAccount();
  const domain = uniqueDomain();

  await test.step('register', async () => {
    await resetRateLimits('register');
    await page.goto('/register');
    await page.getByLabel('Name').fill(account.name);
    await page.getByLabel('Email').fill(account.email);
    await page.getByLabel('Password', { exact: true }).fill(account.password);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  await test.step('add a site', async () => {
    await navigate(page, 'Sites');
    await page.getByRole('link', { name: 'Add site' }).first().click();
    await page.getByLabel('Domain').fill(`https://${domain}/`);
    await page.getByTestId('create').click();
    await expect(page.getByTestId('step-method')).toContainText(domain);
    await page.getByTestId('choose-method').click();
  });

  await test.step('verify ownership with a DNS TXT record', async () => {
    const txtValue = await page.getByRole('textbox', { name: 'TXT record value' }).inputValue();
    expect(txtValue).toMatch(/^sitesentinel-verify=/);

    // Before the record exists, verification explains what it found.
    await page.getByTestId('verify').click();
    await expect(page.getByTestId('verify-error')).toContainText('none equal');

    await publishTxtRecord(domain, txtValue);
    await page.getByTestId('verify').click();
    await expect(page.getByTestId('done')).toContainText(`${domain} is verified`);
  });

  await test.step('run the checks and see an A', async () => {
    await page.getByRole('link', { name: 'View site' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(domain);
    await page.getByTestId('check-now').click();
    await expect(page.getByTestId('grade').first()).toHaveAccessibleName(/^Grade A/, {
      timeout: 45_000,
    });
    await expect(page.getByTestId('check-TLS')).toContainText('Pass');
  });

  let sitePath = '';
  await test.step('add an email alert channel', async () => {
    sitePath = new URL(page.url()).pathname;
    await navigate(page, 'Alert channels');
    await page.getByTestId('add-channel').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: 'Name' }).fill('My inbox');
    await dialog.getByTestId('channel-target').getByRole('textbox').fill(account.email);
    await dialog.getByTestId('channel-save').click();
    await expect(page.getByTestId('channels')).toContainText('My inbox');
  });

  await test.step('the certificate expires and an incident opens', async () => {
    const siteId = sitePath.split('/').at(-1) ?? '';
    await breakSite(domain, 'CERT_EXPIRED');
    await skipCheckNowWindow(siteId);
    await navigate(page, 'Sites');
    await page.getByRole('link', { name: domain }).first().click();
    await page.getByTestId('check-now').click();
    await expect(page.getByTestId('check-TLS')).toContainText('Fail', { timeout: 45_000 });
    await expect(page.getByTestId('check-TLS')).toContainText('expired');

    await navigate(page, 'Incidents');
    const incident = page.getByTestId('incidents').getByRole('link', { name: new RegExp(domain) });
    await expect(incident).toContainText('TLS certificate');
    await expect(incident).toContainText('Open');
  });

  await test.step('the owner is emailed', async () => {
    await expectEmail(account.email, new RegExp(`Incident: ${domain.replaceAll('.', '\\.')}`));
  });
});

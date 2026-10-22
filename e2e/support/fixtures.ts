import { randomUUID } from 'node:crypto';
import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test';
import { PASSWORD } from './env.js';
import { publishTxtRecord, resetRateLimits } from './redis.js';

export interface Account {
  name: string;
  email: string;
  password: string;
}

export interface SiteRef {
  id: string;
  domain: string;
}

const CSRF = { 'X-Requested-With': 'XMLHttpRequest' };

function uniqueId(): string {
  return randomUUID().slice(0, 8);
}

/**
 * A domain nobody else in the run uses. Under example.com (reserved for
 * documentation), so even a misconfigured run could never reach a real site.
 */
export function uniqueDomain(prefix = 'shop'): string {
  return `${prefix}-${uniqueId()}.example.com`;
}

export function newAccount(): Account {
  const id = uniqueId();
  return { name: `E2E ${id}`, email: `e2e-${id}@example.com`, password: PASSWORD };
}

/** Thin client for setting up data through the API, sharing the page's cookies. */
export function apiClient(request: APIRequestContext) {
  async function call<T>(method: 'GET' | 'POST' | 'PATCH', path: string, data?: unknown) {
    const res = await request.fetch(`/api/v1${path}`, { method, data, headers: CSRF });
    expect(res.ok(), `${method} ${path} → ${res.status()} ${await res.text()}`).toBe(true);
    return (await res.json()) as T;
  }

  return {
    async register(account: Account): Promise<void> {
      await resetRateLimits('register');
      await call('POST', '/auth/register', account);
    },
    /** Adds a site and verifies it the way an owner would: by publishing the TXT record. */
    async addVerifiedSite(domain = uniqueDomain(), extra: Record<string, unknown> = {}) {
      const site = await call<{ id: string; verification: { token: string } }>('POST', '/sites', {
        domain,
        ...extra,
      });
      await publishTxtRecord(domain, `sitesentinel-verify=${site.verification.token}`);
      await call('POST', `/sites/${site.id}/verify`, { method: 'DNS_TXT' });
      return { id: site.id, domain } satisfies SiteRef;
    },
    /** Runs every check now and waits until the site has a grade. */
    async checkAndWaitForGrade(site: SiteRef): Promise<void> {
      await call('POST', `/sites/${site.id}/check-now`);
      await expect
        .poll(
          async () =>
            (await call<{ currentGrade: string | null }>('GET', `/sites/${site.id}`)).currentGrade,
          {
            timeout: 45_000,
          },
        )
        .not.toBeNull();
    },
  };
}

export type NavItem = 'Dashboard' | 'Sites' | 'Incidents' | 'Alert channels' | 'Settings';

/** Clicks an entry in the main navigation drawer. */
export async function navigate(page: Page, item: NavItem): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: item, exact: true })
    .click();
}

export const test = base.extend<{ account: Account; api: ReturnType<typeof apiClient> }>({
  api: async ({ page }, use) => {
    await use(apiClient(page.request));
  },
  /** A fresh, signed-in user (cookies are set on the page's browser context). */
  account: async ({ api }, use) => {
    const account = newAccount();
    await api.register(account);
    await use(account);
  },
});

export { expect };

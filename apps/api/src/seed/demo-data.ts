import { randomBytes } from 'node:crypto';
import type { PasswordHasher } from '../auth/passwords.js';
import { AuditLogModel } from '../models/audit-log.model.js';
import { RefreshTokenModel } from '../models/refresh-token.model.js';
import { SiteModel } from '../models/site.model.js';
import { UserModel } from '../models/user.model.js';

export const DEMO_EMAIL = 'demo@sitesentinel.demo';
export const DEMO_PASSWORD = 'DemoPass123!';

/**
 * Well-known public sites, used **only** as demo data. They are marked `demo: true`,
 * shown with a "demo data" label, and checked passively once a day (CLAUDE.md §7).
 */
export const DEMO_SITES: { domain: string; displayName: string; tags: string[] }[] = [
  { domain: 'github.com', displayName: 'GitHub', tags: ['dev-tools'] },
  { domain: 'gitlab.com', displayName: 'GitLab', tags: ['dev-tools'] },
  { domain: 'mozilla.org', displayName: 'Mozilla', tags: ['open-source', 'nonprofit'] },
  { domain: 'wikipedia.org', displayName: 'Wikipedia', tags: ['nonprofit'] },
  { domain: 'python.org', displayName: 'Python', tags: ['open-source'] },
  { domain: 'nodejs.org', displayName: 'Node.js', tags: ['open-source'] },
  { domain: 'rust-lang.org', displayName: 'Rust', tags: ['open-source'] },
  { domain: 'owasp.org', displayName: 'OWASP', tags: ['security', 'nonprofit'] },
  { domain: 'letsencrypt.org', displayName: "Let's Encrypt", tags: ['security', 'nonprofit'] },
  { domain: 'cloudflare.com', displayName: 'Cloudflare', tags: ['infrastructure'] },
  { domain: 'debian.org', displayName: 'Debian', tags: ['open-source'] },
  { domain: 'gov.uk', displayName: 'GOV.UK', tags: ['government'] },
];

/**
 * Recreates the demo account and its sites. Safe to run repeatedly: only data
 * owned by the demo user is removed. Run history arrives with the workers (milestone 4).
 */
export async function seedDemoData(passwords: PasswordHasher, now = new Date()) {
  const existing = await UserModel.findOne({ email: DEMO_EMAIL });
  if (existing) {
    await Promise.all([
      SiteModel.deleteMany({ ownerId: existing._id }),
      RefreshTokenModel.deleteMany({ userId: existing._id }),
      AuditLogModel.deleteMany({ ownerId: existing._id }),
    ]);
    await existing.deleteOne();
  }

  const user = await UserModel.create({
    email: DEMO_EMAIL,
    name: 'Demo User',
    passwordHash: await passwords.hash(DEMO_PASSWORD),
    emailVerifiedAt: now,
  });

  await SiteModel.insertMany(
    DEMO_SITES.map((site) => ({
      ...site,
      ownerId: user._id,
      checkIntervalMinutes: 1440,
      demo: true,
      verification: {
        method: null, // demo data: never actually verified
        token: randomBytes(16).toString('hex'),
        verifiedAt: now,
      },
    })),
  );

  return { userId: user.id as string, sites: DEMO_SITES.length };
}

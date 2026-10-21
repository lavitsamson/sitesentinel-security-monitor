import { jest } from '@jest/globals';
import type { VerificationResult } from '@sitesentinel/checks';
import { AuditLogModel, SiteModel, type SiteDocument } from '@sitesentinel/db';
import { MemoryMailer } from '../mail/mailer.js';
import {
  DAY,
  createSite,
  createUser,
  manualClock,
  silentLogger,
  useTestMongo,
} from '../test/helpers.js';
import { createVerificationProcessor, type VerifyOwnership } from './verification-processor.js';

useTestMongo();

const verified: VerificationResult = { verified: true, method: 'WELL_KNOWN_FILE', attempts: [] };
const notVerified: VerificationResult = { verified: false, method: null, attempts: [] };

function setup(result: VerificationResult) {
  const clock = manualClock();
  const mailer = new MemoryMailer();
  const verifyOwnership = jest.fn<VerifyOwnership>(async () => result);
  const process = createVerificationProcessor({
    verifyOwnership,
    mailer,
    clock,
    logger: silentLogger,
    webOrigin: 'https://app.example',
  });
  return { clock, mailer, verifyOwnership, process };
}

const reload = async (site: SiteDocument) => (await SiteModel.findById(site._id))!;

describe('re-verification', () => {
  it('records a successful proof and clears earlier failures', async () => {
    const { clock, process, verifyOwnership } = setup(verified);
    const owner = await createUser();
    const site = await createSite(owner._id, { consecutiveFailures: 2 });

    expect(await process({ siteId: site.id })).toEqual({ kind: 'VERIFIED' });

    expect(verifyOwnership).toHaveBeenCalledWith({ domain: site.domain, token: 'token-123' });
    const after = await reload(site);
    expect(after.verification).toMatchObject({
      verifiedAt: clock.now(),
      lastAttemptAt: clock.now(),
      method: 'WELL_KNOWN_FILE',
      consecutiveFailures: 0,
    });
    expect(after.paused).toBe(false);
  });

  it('counts failures, then pauses the site, revokes verification and emails the owner', async () => {
    const { clock, mailer, process } = setup(notVerified);
    const owner = await createUser('ada@example.com');
    const site = await createSite(owner._id, { domain: 'lapsed.example.com' });

    expect(await process({ siteId: site.id })).toEqual({ kind: 'FAILED', consecutiveFailures: 1 });
    clock.advance(DAY);
    expect(await process({ siteId: site.id })).toEqual({ kind: 'FAILED', consecutiveFailures: 2 });
    expect((await reload(site)).verification.verifiedAt).not.toBeNull();
    expect(mailer.sent).toHaveLength(0);

    clock.advance(DAY);
    expect(await process({ siteId: site.id })).toEqual({ kind: 'REVOKED' });

    const after = await reload(site);
    expect(after.paused).toBe(true);
    expect(after.verification).toMatchObject({ verifiedAt: null, consecutiveFailures: 3 });
    expect(mailer.last()).toMatchObject({
      to: 'ada@example.com',
      subject: 'SiteSentinel paused monitoring of lapsed.example.com',
    });
    expect(mailer.last()!.text).toContain(`https://app.example/sites/${site.id}`);
    expect(await AuditLogModel.findOne({ entityId: site.id })).toMatchObject({
      action: 'site.verification.revoked',
      ip: null,
    });
  });

  it.each([
    ['deleted', {}],
    ['demo', { demo: true }],
    ['paused', { paused: true }],
    ['unverified', { verifiedAt: null }],
  ] as const)('skips a %s site', async (state, overrides) => {
    const { process, verifyOwnership } = setup(verified);
    const owner = await createUser();
    const site = await createSite(owner._id, overrides);
    if (state === 'deleted') await site.deleteOne();

    expect(await process({ siteId: site.id })).toEqual({ kind: 'SKIPPED' });
    expect(verifyOwnership).not.toHaveBeenCalled();
  });
});

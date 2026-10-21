import { SiteModel } from '@sitesentinel/db';
import { CHECK_TYPES } from '@sitesentinel/shared';
import {
  DAY,
  MINUTE,
  MemoryEnqueuer,
  createSite,
  createUser,
  manualClock,
  silentLogger,
  useTestMongo,
} from '../test/helpers.js';
import { createScheduler } from './scheduler.js';

useTestMongo();

function setup(batchSize?: number) {
  const clock = manualClock();
  const queue = new MemoryEnqueuer();
  const scheduler = createScheduler({
    checks: queue,
    verifications: queue,
    clock,
    logger: silentLogger,
    ...(batchSize && { batchSize }),
  });
  return { clock, queue, scheduler };
}

const scheduledSites = (queue: MemoryEnqueuer) =>
  new Set([...queue.checks.values()].map((job) => job.siteId));

describe('scheduler: checks', () => {
  it('enqueues every check type for a verified site that was never checked', async () => {
    const { queue, scheduler } = setup();
    const owner = await createUser();
    const site = await createSite(owner._id);

    const result = await scheduler.tick();

    expect(result.sitesDue).toBe(1);
    const jobs = [...queue.checks.values()];
    expect(jobs.map((j) => j.type).sort()).toEqual([...CHECK_TYPES].sort());
    for (const job of jobs) {
      expect(job).toMatchObject({ siteId: site.id, trigger: 'SCHEDULED', slot: 'first' });
      expect(job.delayMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('never schedules unverified or paused sites', async () => {
    const { queue, scheduler } = setup();
    const owner = await createUser();
    await createSite(owner._id, { verifiedAt: null });
    await createSite(owner._id, { paused: true });

    expect((await scheduler.tick()).sitesDue).toBe(0);
    expect(queue.checks.size).toBe(0);
  });

  it.each([
    [5, 4, false],
    [5, 5, true],
    [15, 14, false],
    [15, 15, true],
    [60, 59, false],
    [60, 60, true],
    [1440, 1439, false],
    [1440, 1440, true],
  ] as const)(
    'with a %i-minute interval, a site checked %i minutes ago is due: %s',
    async (interval, minutesAgo, due) => {
      const { clock, queue, scheduler } = setup();
      const owner = await createUser();
      const site = await createSite(owner._id, {
        checkIntervalMinutes: interval,
        lastCheckedAt: new Date(clock.now().getTime() - minutesAgo * MINUTE),
      });

      await scheduler.tick();

      expect(scheduledSites(queue).has(site.id)).toBe(due);
    },
  );

  it('produces the same job ids on every tick until the check completes', async () => {
    const { clock, queue, scheduler } = setup();
    const owner = await createUser();
    const site = await createSite(owner._id, { checkIntervalMinutes: 5 });

    await scheduler.tick();
    clock.advance(MINUTE);
    await scheduler.tick();
    clock.advance(10 * MINUTE); // still queued (e.g. a backlog): still the same slot
    await scheduler.tick();
    expect(queue.checks.size).toBe(CHECK_TYPES.length);

    // The check completes, then one interval later the next slot opens.
    await SiteModel.updateOne({ _id: site._id }, { lastCheckedAt: clock.now() });
    await scheduler.tick();
    expect(queue.checks.size).toBe(CHECK_TYPES.length);
    clock.advance(5 * MINUTE);
    await scheduler.tick();
    expect(queue.checks.size).toBe(2 * CHECK_TYPES.length);
  });

  it('enqueues every due site, not just the first batch', async () => {
    const { queue, scheduler } = setup(2);
    const owner = await createUser();
    await Promise.all(Array.from({ length: 5 }, () => createSite(owner._id)));

    expect((await scheduler.tick()).sitesDue).toBe(5);
    expect(scheduledSites(queue).size).toBe(5);
  });
});

describe('scheduler: re-verification', () => {
  async function dueForReverify(overrides: Parameters<typeof createSite>[1]) {
    const { queue, scheduler } = setup();
    const owner = await createUser();
    const site = await createSite(owner._id, overrides);
    await scheduler.tick();
    return [...queue.verifications.values()].some((job) => job.siteId === site.id);
  }

  const now = manualClock().now().getTime();
  const ago = (ms: number) => new Date(now - ms);

  it.each([
    ['verified 6 days ago', { verifiedAt: ago(6 * DAY), lastAttemptAt: ago(6 * DAY) }, false],
    ['verified 7 days ago', { verifiedAt: ago(7 * DAY), lastAttemptAt: ago(7 * DAY) }, true],
    ['verified 7 days ago, no attempt recorded', { verifiedAt: ago(7 * DAY) }, true],
    [
      'failed once, 23 hours ago',
      { verifiedAt: ago(8 * DAY), lastAttemptAt: ago(23 * 3600_000), consecutiveFailures: 1 },
      false,
    ],
    [
      'failed once, a day ago',
      { verifiedAt: ago(8 * DAY), lastAttemptAt: ago(DAY), consecutiveFailures: 1 },
      true,
    ],
    ['a demo site', { verifiedAt: ago(30 * DAY), demo: true }, false],
    ['a paused site', { verifiedAt: ago(30 * DAY), paused: true }, false],
    ['an unverified site', { verifiedAt: null, lastAttemptAt: ago(30 * DAY) }, false],
  ] as const)('%s → due: %s', async (_label, overrides, due) => {
    expect(await dueForReverify(overrides)).toBe(due);
  });

  it('uses the last attempt as the slot, so a pending re-verification is not duplicated', async () => {
    const { queue, scheduler } = setup();
    const owner = await createUser();
    await createSite(owner._id, { verifiedAt: ago(8 * DAY), lastAttemptAt: ago(8 * DAY) });

    await scheduler.tick();
    await scheduler.tick();

    expect(queue.verifications.size).toBe(1);
  });
});

import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { E2E } from './env.js';

// Mirrors @sitesentinel/checks/simulated; kept local so the suite drives the
// stack only from the outside (browser, Redis, Mailpit).
const SIMULATED_KEY_PREFIX = 'simulated-network:';

export type SimulatedFault = 'CERT_EXPIRED' | 'DOWN' | 'PLAIN_HTTP';

interface SimulatedDomainState {
  txt?: string[];
  verificationFile?: string;
  fault?: SimulatedFault;
}

let client: Redis | undefined;

function redis(): Redis {
  client ??= new Redis(E2E.redisUrl, { lazyConnect: false, maxRetriesPerRequest: 3 });
  return client;
}

export async function closeRedis(): Promise<void> {
  await client?.quit();
  client = undefined;
}

async function updateDomain(domain: string, patch: SimulatedDomainState): Promise<void> {
  const key = `${SIMULATED_KEY_PREFIX}${domain}`;
  const current = JSON.parse((await redis().get(key)) ?? '{}') as SimulatedDomainState;
  await redis().set(key, JSON.stringify({ ...current, ...patch }), 'EX', 24 * 60 * 60);
}

/** Acts as the domain owner adding a TXT record at their DNS provider. */
export async function publishTxtRecord(domain: string, value: string): Promise<void> {
  await updateDomain(domain, { txt: [value] });
}

/** Breaks the simulated site, e.g. lets its certificate expire. */
export async function breakSite(domain: string, fault: SimulatedFault): Promise<void> {
  await updateDomain(domain, { fault });
}

async function deleteMatching(pattern: string): Promise<void> {
  const keys = await redis().keys(pattern);
  if (keys.length > 0) await redis().del(...keys);
}

/**
 * Rate limits are covered by the API's integration tests. The suite creates
 * many accounts from one IP and re-checks sites within minutes, so it clears
 * the counters that would otherwise get in the way.
 */
export async function resetRateLimits(name = '*'): Promise<void> {
  await deleteMatching(`rl:${name}:*`);
}

/**
 * Fast-forwards past a site's 5-minute check-now window. Check-now is limited
 * twice: by the rate limiter and by job ids shared within the window, so a
 * repeat is a no-op in BullMQ. Clearing the counter and removing the site's
 * finished manual jobs is what the window ending would do.
 */
export async function skipCheckNowWindow(siteId: string): Promise<void> {
  await resetRateLimits('check-now');
  const queue = new Queue('checks', { connection: redis() });
  try {
    const jobs = await queue.getJobs(['completed', 'failed']);
    const manual = jobs.filter((j) => j?.id?.startsWith(`${siteId}.`) && j.id.includes('.manual-'));
    await Promise.all(manual.map((j) => queue.remove(j.id as string)));
  } finally {
    await queue.close();
  }
}

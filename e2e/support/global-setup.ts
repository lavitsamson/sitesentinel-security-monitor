import { closeRedis, resetRateLimits } from './redis.js';

/** Runs once, after the servers are up. Accounts and domains are unique per test. */
export default async function globalSetup(): Promise<void> {
  await resetRateLimits();
  await closeRedis();
}

import type { Redis } from 'ioredis';

export interface DomainLease {
  release(): Promise<void>;
}

/**
 * At most one check in flight per domain, across every worker process
 * (CLAUDE.md §9), so SiteSentinel never sends a site more than one request at a time.
 */
export interface DomainLock {
  /** Returns null when another check already holds the domain. */
  acquire(domain: string, holder: string): Promise<DomainLease | null>;
}

/** Longer than the slowest check (a few 10 s-capped requests), so a crashed holder frees it. */
export const DOMAIN_LOCK_TTL_MS = 60_000;

// Delete only if we still hold it: after a TTL expiry another holder may own the key.
const RELEASE_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0`;

export function createRedisDomainLock(redis: Redis, ttlMs = DOMAIN_LOCK_TTL_MS): DomainLock {
  return {
    async acquire(domain, holder) {
      const key = `lock:domain:${domain}`;
      const ok = await redis.set(key, holder, 'PX', ttlMs, 'NX');
      if (ok !== 'OK') return null;
      return {
        async release() {
          await redis.eval(RELEASE_SCRIPT, 1, key, holder);
        },
      };
    },
  };
}

/** Single-process lock for tests. */
export function createMemoryDomainLock(): DomainLock & { held(): string[] } {
  const holders = new Map<string, string>();
  return {
    async acquire(domain, holder) {
      if (holders.has(domain)) return null;
      holders.set(domain, holder);
      return {
        async release() {
          if (holders.get(domain) === holder) holders.delete(domain);
        },
      };
    },
    held: () => [...holders.keys()],
  };
}

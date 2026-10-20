import { Redis } from 'ioredis';
import type { DependencyProbe } from '../health/readiness.js';

export function createRedis(url: string): Redis {
  // No offline queue: while disconnected, commands fail immediately instead of
  // piling up, so the readiness probe reports the outage straight away.
  return new Redis(url, { enableOfflineQueue: false, lazyConnect: true });
}

export function redisProbe(redis: Redis): DependencyProbe {
  return () => redis.ping();
}

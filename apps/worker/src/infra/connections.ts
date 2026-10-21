import { Redis } from 'ioredis';

/**
 * BullMQ workers block on Redis commands, so they require
 * `maxRetriesPerRequest: null` (retry forever rather than fail the command).
 */
export function createQueueRedis(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null, lazyConnect: true });
}

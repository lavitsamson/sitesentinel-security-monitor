import { Redis } from 'ioredis';
import mongoose from 'mongoose';

export async function connectMongo(url: string): Promise<typeof mongoose> {
  return mongoose.connect(url, { serverSelectionTimeoutMS: 5_000 });
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
}

/**
 * BullMQ workers block on Redis commands, so they require
 * `maxRetriesPerRequest: null` (retry forever rather than fail the command).
 */
export function createQueueRedis(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null, lazyConnect: true });
}

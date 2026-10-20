import { registerGracefulShutdown } from '@sitesentinel/shared/node';
import { loadConfig } from './config.js';
import { connectMongo, createQueueRedis, disconnectMongo } from './infra/connections.js';
import { createLogger } from './logger.js';

const config = loadConfig();
const logger = createLogger(config);

const redis = createQueueRedis(config.redisUrl);
redis.on('error', (err) => logger.warn({ err }, 'redis error'));

await Promise.all([connectMongo(config.mongoUrl), redis.connect()]);

// Queues (checks, alerts, verification) and the scheduler are registered here in milestone 4.
logger.info({ concurrency: config.concurrency }, 'worker ready');

registerGracefulShutdown(
  [
    // Queue workers are closed first (finishing in-flight jobs) once they exist.
    { name: 'mongo', close: disconnectMongo },
    { name: 'redis', close: async () => void (await redis.quit()) },
  ],
  { logger, timeoutMs: config.shutdownTimeoutMs },
);

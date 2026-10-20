import { registerGracefulShutdown } from '@sitesentinel/shared/node';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { connectMongo, disconnectMongo, pingMongo } from './infra/mongo.js';
import { createRedis, redisProbe } from './infra/redis.js';
import { createLogger } from './logger.js';

const config = loadConfig();
const logger = createLogger(config);
const version = process.env.npm_package_version ?? '0.0.0';

const redis = createRedis(config.redisUrl);
redis.on('error', (err) => logger.warn({ err }, 'redis error'));

await Promise.all([connectMongo(config.mongoUrl), redis.connect()]);

const app = createApp({
  config,
  logger,
  version,
  readinessProbes: { mongo: pingMongo, redis: redisProbe(redis) },
});

const server = app.listen(config.port, () => {
  logger.info({ port: config.port }, 'api listening');
});

registerGracefulShutdown(
  [
    {
      name: 'http',
      close: () =>
        new Promise<void>((resolve, reject) => {
          server.close((err) => (err ? reject(err) : resolve()));
        }),
    },
    { name: 'mongo', close: disconnectMongo },
    { name: 'redis', close: async () => void (await redis.quit()) },
  ],
  { logger },
);

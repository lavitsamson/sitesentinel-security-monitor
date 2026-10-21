import {
  buildUserAgent,
  createSafeHttpClient,
  createSystemDnsResolver,
  systemClock,
  systemLookup,
  verifyOwnership,
} from '@sitesentinel/checks';
import { registerGracefulShutdown } from '@sitesentinel/shared/node';
import { createApp } from './app.js';
import { createPasswordHasher } from './auth/passwords.js';
import { loadConfig } from './config.js';
import { redisRateLimitStores } from './http/rate-limits.js';
import { connectMongo, disconnectMongo, pingMongo } from './infra/mongo.js';
import { createRedis, redisProbe } from './infra/redis.js';
import { createLogger } from './logger.js';
import { createSmtpMailer } from './mail/mailer.js';

const config = loadConfig();
const logger = createLogger(config);
const version = process.env.npm_package_version ?? '0.0.0';

const redis = createRedis(config.redisUrl);
redis.on('error', (err) => logger.warn({ err }, 'redis error'));

await Promise.all([connectMongo(config.mongoUrl), redis.connect()]);

// Verification is the API's only outbound traffic, and it goes through the SSRF guard.
const verificationDeps = {
  http: createSafeHttpClient({ lookup: systemLookup, userAgent: buildUserAgent(version) }),
  dns: createSystemDnsResolver(),
};

const app = createApp({
  config,
  logger,
  version,
  readinessProbes: { mongo: pingMongo, redis: redisProbe(redis) },
  mailer: createSmtpMailer(config.smtpUrl, config.mailFrom),
  passwords: createPasswordHasher(),
  rateLimitStores: redisRateLimitStores(redis),
  verifyOwnership: (claim) => verifyOwnership(claim, verificationDeps),
  clock: systemClock,
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

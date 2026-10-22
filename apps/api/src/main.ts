import {
  buildUserAgent,
  createSafeHttpClient,
  createSystemDnsResolver,
  systemClock,
  systemLookup,
  verifyOwnership,
} from '@sitesentinel/checks';
import { createSimulatedNetwork } from '@sitesentinel/checks/simulated';
import { registerGracefulShutdown } from '@sitesentinel/shared/node';
import { connectMongo, disconnectMongo } from '@sitesentinel/db';
import { createQueueBoard } from './admin/queue-board.js';
import { createApp } from './app.js';
import { createPasswordHasher } from './auth/passwords.js';
import { loadConfig } from './config.js';
import { redisRateLimitStores } from './http/rate-limits.js';
import { bullAlertEnqueuer } from './infra/alert-queue.js';
import { bullCheckEnqueuer } from './infra/check-queue.js';
import { pingMongo } from './infra/mongo.js';
import { createQueues, queueJobCounts } from './infra/queues.js';
import { createRedis, redisProbe } from './infra/redis.js';
import { createLogger } from './logger.js';
import { createSmtpMailer } from './mail/mailer.js';
import { createApiMetrics } from './metrics/metrics.js';

const config = loadConfig();
const logger = createLogger(config);
const version = process.env.npm_package_version ?? '0.0.0';

const redis = createRedis(config.redisUrl);
redis.on('error', (err) => logger.warn({ err }, 'redis error'));

await Promise.all([connectMongo(config.mongoUrl), redis.connect()]);

// Verification is the API's only outbound traffic, and it goes through the SSRF guard.
// The E2E suite swaps in a simulated internet so no real domain is contacted.
const verificationDeps = config.simulatedNetwork
  ? createSimulatedNetwork({ store: redis, clock: systemClock })
  : {
      http: createSafeHttpClient({ lookup: systemLookup, userAgent: buildUserAgent(version) }),
      dns: createSystemDnsResolver(),
    };
if (config.simulatedNetwork) logger.warn('SIMULATED_NETWORK=true: no real requests will be made');

const queues = createQueues(redis);
if (!config.queueBoard) logger.info('bull board disabled (set BULL_BOARD_PASSWORD to enable)');

const app = createApp({
  config,
  logger,
  version,
  readinessProbes: { mongo: pingMongo, redis: redisProbe(redis) },
  mailer: createSmtpMailer(config.smtpUrl, config.mailFrom),
  passwords: createPasswordHasher(),
  rateLimitStores: redisRateLimitStores(redis),
  verifyOwnership: (claim) => verifyOwnership(claim, verificationDeps),
  checks: bullCheckEnqueuer(queues.checks),
  alerts: bullAlertEnqueuer(queues.alerts, systemClock),
  clock: systemClock,
  metrics: createApiMetrics({ defaultMetrics: true, queueCounts: queueJobCounts(queues), logger }),
  ...(config.queueBoard && {
    queueBoard: {
      handler: createQueueBoard(Object.values(queues)),
      credentials: config.queueBoard,
    },
  }),
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
    {
      name: 'queues',
      close: async () => void (await Promise.all(Object.values(queues).map((q) => q.close()))),
    },
    { name: 'mongo', close: disconnectMongo },
    { name: 'redis', close: async () => void (await redis.quit()) },
  ],
  { logger },
);

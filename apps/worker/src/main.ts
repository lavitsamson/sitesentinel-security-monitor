import {
  buildUserAgent,
  createSafeHttpClient,
  createSafeTlsConnector,
  createSystemDnsResolver,
  runCheck,
  systemClock,
  systemLookup,
  verifyOwnership,
  type CheckDeps,
} from '@sitesentinel/checks';
import { connectMongo, disconnectMongo } from '@sitesentinel/db';
import { registerGracefulShutdown } from '@sitesentinel/shared/node';
import { createCheckProcessor } from './checks/check-processor.js';
import { loadConfig } from './config.js';
import { createRedisDomainLock } from './infra/domain-lock.js';
import { createQueueRedis } from './infra/connections.js';
import { createLogger } from './logger.js';
import { createSmtpMailer } from './mail/mailer.js';
import {
  bullCheckEnqueuer,
  bullVerificationEnqueuer,
  createQueues,
  startWorkers,
} from './queues/bull.js';
import { createScheduler } from './scheduler/scheduler.js';
import { createVerificationProcessor } from './verification/verification-processor.js';

const config = loadConfig();
const logger = createLogger(config);
const version = process.env.npm_package_version ?? '0.0.0';

const redis = createQueueRedis(config.redisUrl);
redis.on('error', (err) => logger.warn({ err }, 'redis error'));

await Promise.all([connectMongo(config.mongoUrl), redis.connect()]);

// Every outbound request goes through the SSRF guard (ADR 0002).
const checkDeps: CheckDeps = {
  http: createSafeHttpClient({ lookup: systemLookup, userAgent: buildUserAgent(version) }),
  tls: createSafeTlsConnector({ lookup: systemLookup }),
  dns: createSystemDnsResolver(),
  clock: systemClock,
};

const queues = createQueues(redis);
const workers = await startWorkers({
  connection: redis,
  queues,
  concurrency: config.concurrency,
  logger,
  processors: {
    check: createCheckProcessor({
      runCheck: (type, target) => runCheck(type, target, checkDeps),
      lock: createRedisDomainLock(redis),
      clock: systemClock,
      logger,
    }),
    verification: createVerificationProcessor({
      verifyOwnership: (claim) => verifyOwnership(claim, checkDeps),
      mailer: createSmtpMailer(config.smtpUrl, config.mailFrom),
      clock: systemClock,
      logger,
      webOrigin: config.webOrigin,
    }),
    scheduler: createScheduler({
      checks: bullCheckEnqueuer(queues.checks),
      verifications: bullVerificationEnqueuer(queues.verification),
      clock: systemClock,
      logger,
    }),
  },
});
logger.info({ concurrency: config.concurrency }, 'worker ready');

registerGracefulShutdown(
  [
    // Workers first: close() stops taking jobs and waits for in-flight ones to finish.
    { name: 'workers', close: async () => void (await Promise.all(workers.map((w) => w.close()))) },
    {
      name: 'queues',
      close: async () => void (await Promise.all(Object.values(queues).map((q) => q.close()))),
    },
    { name: 'mongo', close: disconnectMongo },
    { name: 'redis', close: async () => void (await redis.quit()) },
  ],
  { logger, timeoutMs: config.shutdownTimeoutMs },
);

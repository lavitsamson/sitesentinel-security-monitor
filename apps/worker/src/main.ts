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
import { createSimulatedNetwork } from '@sitesentinel/checks/simulated';
import { connectMongo, disconnectMongo } from '@sitesentinel/db';
import { decryptSecret, registerGracefulShutdown } from '@sitesentinel/shared/node';
import { createAlertProcessor } from './alerts/alert-processor.js';
import { createAlertSender } from './alerts/senders.js';
import { createCheckProcessor } from './checks/check-processor.js';
import { loadConfig } from './config.js';
import { createRedisDomainLock } from './infra/domain-lock.js';
import { createQueueRedis } from './infra/connections.js';
import { createLogger } from './logger.js';
import { createSmtpMailer } from './mail/mailer.js';
import { createWorkerMetrics } from './metrics/metrics.js';
import { closeServer, startMetricsServer } from './metrics/server.js';
import {
  bullAlertEnqueuer,
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

// Every outbound request goes through the SSRF guard (ADR 0002). The E2E suite
// swaps in a simulated internet so no real domain is contacted.
const checkDeps: CheckDeps = config.simulatedNetwork
  ? { ...createSimulatedNetwork({ store: redis, clock: systemClock }), clock: systemClock }
  : {
      http: createSafeHttpClient({ lookup: systemLookup, userAgent: buildUserAgent(version) }),
      tls: createSafeTlsConnector({ lookup: systemLookup }),
      dns: createSystemDnsResolver(),
      clock: systemClock,
    };
if (config.simulatedNetwork) logger.warn('SIMULATED_NETWORK=true: no real requests will be made');

const metrics = createWorkerMetrics({ defaultMetrics: true });
const metricsServer =
  config.metricsPort === null
    ? null
    : await startMetricsServer({
        registry: metrics.registry,
        port: config.metricsPort,
        token: config.metricsToken,
        logger,
      });

const queues = createQueues(redis);
const mailer = createSmtpMailer(config.smtpUrl, config.mailFrom);
const workers = await startWorkers({
  connection: redis,
  queues,
  concurrency: config.concurrency,
  logger,
  metrics,
  processors: {
    check: createCheckProcessor({
      runCheck: (type, target) => runCheck(type, target, checkDeps),
      lock: createRedisDomainLock(redis),
      alerts: bullAlertEnqueuer(queues.alerts, systemClock),
      clock: systemClock,
      logger,
    }),
    verification: createVerificationProcessor({
      verifyOwnership: (claim) => verifyOwnership(claim, checkDeps),
      mailer,
      clock: systemClock,
      logger,
      webOrigin: config.webOrigin,
    }),
    alert: createAlertProcessor({
      send: createAlertSender({ mailer, http: checkDeps.http, clock: systemClock }),
      decryptSecret: (encrypted) => decryptSecret(encrypted, config.alertSecretKey),
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
    // After the workers, so the last jobs' metrics can still be scraped while they finish.
    ...(metricsServer ? [{ name: 'metrics', close: () => closeServer(metricsServer) }] : []),
    { name: 'mongo', close: disconnectMongo },
    { name: 'redis', close: async () => void (await redis.quit()) },
  ],
  { logger, timeoutMs: config.shutdownTimeoutMs },
);

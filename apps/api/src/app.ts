import type { Clock } from '@sitesentinel/checks';
import type { AlertEnqueuer, CheckEnqueuer } from '@sitesentinel/shared';
import type { DependencyProbe } from '@sitesentinel/shared/node';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express, type RequestHandler } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import {
  QUEUE_BOARD_PATH,
  requireQueueBoardAdmin,
  type QueueBoardCredentials,
} from './admin/queue-board.js';
import { alertChannelsRouter } from './alert-channels/alert-channels.routes.js';
import { createAlertChannelsService } from './alert-channels/alert-channels.service.js';
import { requireAuth } from './auth/auth.middleware.js';
import { authRouter } from './auth/auth.routes.js';
import { createAuthService } from './auth/auth.service.js';
import type { PasswordHasher } from './auth/passwords.js';
import { createSessionService } from './auth/sessions.js';
import { createAccessTokens } from './auth/tokens.js';
import type { Config } from './config.js';
import { healthRouter } from './health/health.routes.js';
import { requireCsrfHeader } from './http/csrf.js';
import { errorHandler, notFoundHandler } from './http/errors.js';
import { createRateLimiters, type RateLimitStoreFactory } from './http/rate-limits.js';
import { genReqId } from './http/request-id.js';
import { incidentsRouter } from './incidents/incidents.routes.js';
import { createIncidentsService } from './incidents/incidents.service.js';
import type { Logger } from './logger.js';
import type { Mailer } from './mail/mailer.js';
import type { ApiMetrics } from './metrics/metrics.js';
import { metricsRouter } from './metrics/metrics.routes.js';
import { API_PREFIX, buildOpenApiDocument } from './openapi/document.js';
import { docsRouter } from './openapi/docs.routes.js';
import { reportsRouter } from './reports/reports.routes.js';
import { createReportsService } from './reports/reports.service.js';
import { resultsRouter } from './results/results.routes.js';
import { createResultsService } from './results/results.service.js';
import { sitesRouter } from './sites/sites.routes.js';
import { createSitesService, type VerifyOwnership } from './sites/sites.service.js';

export interface AppDeps {
  config: Pick<
    Config,
    | 'webOrigin'
    | 'bodyLimit'
    | 'readinessTimeoutMs'
    | 'trustProxy'
    | 'auth'
    | 'alertSecretKey'
    | 'metricsToken'
  >;
  logger: Logger;
  /** Dependencies checked by /health/ready, e.g. { mongo, redis }. */
  readinessProbes: Record<string, DependencyProbe>;
  version: string;
  mailer: Mailer;
  passwords: PasswordHasher;
  rateLimitStores: RateLimitStoreFactory;
  /** Domain-ownership proof; in production it makes SSRF-guarded DNS/HTTP requests. */
  verifyOwnership: VerifyOwnership;
  /** The `checks` queue, for check-now; the worker consumes it. */
  checks: CheckEnqueuer;
  /** The `alerts` queue, for test sends; the worker delivers them. */
  alerts: AlertEnqueuer;
  clock: Clock;
  metrics: ApiMetrics;
  /** Bull Board and who may open it; omitted when the board is disabled. */
  queueBoard?: { handler: RequestHandler; credentials: QueueBoardCredentials };
}

/** Builds the Express app. It has no side effects, so tests create one per case. */
export function createApp(deps: AppDeps): Express {
  const { config, logger, readinessProbes, version, clock } = deps;

  const accessTokens = createAccessTokens(
    config.auth.jwtSecret,
    config.auth.accessTokenTtlSeconds,
    clock,
  );
  const sessions = createSessionService({
    accessTokens,
    refreshTokenTtlDays: config.auth.refreshTokenTtlDays,
    clock,
  });
  const auth = createAuthService({
    passwords: deps.passwords,
    sessions,
    mailer: deps.mailer,
    clock,
    logger,
    webOrigin: config.webOrigin,
    passwordResetTtlMinutes: config.auth.passwordResetTtlMinutes,
  });
  const sites = createSitesService({
    verifyOwnership: deps.verifyOwnership,
    checks: deps.checks,
    clock,
  });
  const results = createResultsService({ clock });
  const incidents = createIncidentsService();
  const reports = createReportsService({ results, incidents, clock });
  const alertChannels = createAlertChannelsService({
    alerts: deps.alerts,
    secretKey: config.alertSecretKey,
  });
  const limiters = createRateLimiters(deps.rateLimitStores);
  const authenticated = requireAuth(accessTokens);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(pinoHttp({ logger, genReqId }));
  app.use(helmet());

  // Before request metrics: the board polls every few seconds and is not API traffic.
  if (deps.queueBoard) {
    app.use(
      QUEUE_BOARD_PATH,
      limiters.queueBoard,
      requireQueueBoardAdmin(deps.queueBoard.credentials),
      deps.queueBoard.handler,
    );
  }

  app.use(deps.metrics.observeRequests);
  app.use(cors({ origin: [config.webOrigin], credentials: true }));
  app.use(express.json({ limit: config.bodyLimit }));
  app.use(cookieParser());

  app.use('/api/docs', docsRouter(buildOpenApiDocument(version)));
  app.use(API_PREFIX, healthRouter(readinessProbes, config.readinessTimeoutMs));
  app.use(API_PREFIX, metricsRouter(deps.metrics, config.metricsToken));
  app.use(API_PREFIX, requireCsrfHeader);
  app.use(
    API_PREFIX,
    authRouter({ auth, sessions, config: config.auth, limiters, requireAuth: authenticated }),
  );
  app.use(
    API_PREFIX,
    sitesRouter({
      sites,
      requireAuth: authenticated,
      verifyRateLimit: limiters.verifySite,
      checkNowRateLimit: limiters.checkNow,
      bulkRateLimit: limiters.bulkSites,
    }),
  );
  app.use(API_PREFIX, resultsRouter({ results, requireAuth: authenticated }));
  app.use(
    API_PREFIX,
    reportsRouter({ reports, requireAuth: authenticated, reportRateLimit: limiters.report }),
  );
  app.use(API_PREFIX, incidentsRouter({ incidents, requireAuth: authenticated }));
  app.use(
    API_PREFIX,
    alertChannelsRouter({
      channels: alertChannels,
      requireAuth: authenticated,
      testRateLimit: limiters.testAlert,
    }),
  );

  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}

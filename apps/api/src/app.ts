import type { Clock } from '@sitesentinel/checks';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { requireAuth } from './auth/auth.middleware.js';
import { authRouter } from './auth/auth.routes.js';
import { createAuthService } from './auth/auth.service.js';
import type { PasswordHasher } from './auth/passwords.js';
import { createSessionService } from './auth/sessions.js';
import { createAccessTokens } from './auth/tokens.js';
import type { Config } from './config.js';
import { healthRouter } from './health/health.routes.js';
import type { DependencyProbe } from './health/readiness.js';
import { requireCsrfHeader } from './http/csrf.js';
import { errorHandler, notFoundHandler } from './http/errors.js';
import { createRateLimiters, type RateLimitStoreFactory } from './http/rate-limits.js';
import { genReqId } from './http/request-id.js';
import type { Logger } from './logger.js';
import type { Mailer } from './mail/mailer.js';
import { API_PREFIX, buildOpenApiDocument } from './openapi/document.js';
import { docsRouter } from './openapi/docs.routes.js';
import { sitesRouter } from './sites/sites.routes.js';
import { createSitesService, type VerifyOwnership } from './sites/sites.service.js';

export interface AppDeps {
  config: Pick<Config, 'webOrigin' | 'bodyLimit' | 'readinessTimeoutMs' | 'trustProxy' | 'auth'>;
  logger: Logger;
  /** Dependencies checked by /health/ready, e.g. { mongo, redis }. */
  readinessProbes: Record<string, DependencyProbe>;
  version: string;
  mailer: Mailer;
  passwords: PasswordHasher;
  rateLimitStores: RateLimitStoreFactory;
  /** Domain-ownership proof; in production it makes SSRF-guarded DNS/HTTP requests. */
  verifyOwnership: VerifyOwnership;
  clock: Clock;
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
  const sites = createSitesService({ verifyOwnership: deps.verifyOwnership, clock });
  const limiters = createRateLimiters(deps.rateLimitStores);
  const authenticated = requireAuth(accessTokens);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(pinoHttp({ logger, genReqId }));
  app.use(helmet());
  app.use(cors({ origin: [config.webOrigin], credentials: true }));
  app.use(express.json({ limit: config.bodyLimit }));
  app.use(cookieParser());

  app.use('/api/docs', docsRouter(buildOpenApiDocument(version)));
  app.use(API_PREFIX, healthRouter(readinessProbes, config.readinessTimeoutMs));
  app.use(API_PREFIX, requireCsrfHeader);
  app.use(
    API_PREFIX,
    authRouter({ auth, sessions, config: config.auth, limiters, requireAuth: authenticated }),
  );
  app.use(
    API_PREFIX,
    sitesRouter({ sites, requireAuth: authenticated, verifyRateLimit: limiters.verifySite }),
  );

  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}

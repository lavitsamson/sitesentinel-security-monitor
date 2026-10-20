import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Config } from './config.js';
import { healthRouter } from './health/health.routes.js';
import type { DependencyProbe } from './health/readiness.js';
import { errorHandler, notFoundHandler } from './http/errors.js';
import { genReqId } from './http/request-id.js';
import type { Logger } from './logger.js';
import { API_PREFIX, buildOpenApiDocument } from './openapi/document.js';
import { docsRouter } from './openapi/docs.routes.js';

export interface AppDeps {
  config: Pick<Config, 'webOrigin' | 'bodyLimit' | 'readinessTimeoutMs'>;
  logger: Logger;
  /** Dependencies checked by /health/ready, e.g. { mongo, redis }. */
  readinessProbes: Record<string, DependencyProbe>;
  version: string;
}

/** Builds the Express app. It has no side effects, so tests create one per case. */
export function createApp({ config, logger, readinessProbes, version }: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');

  app.use(pinoHttp({ logger, genReqId }));
  app.use(helmet());
  app.use(cors({ origin: [config.webOrigin], credentials: true }));
  app.use(express.json({ limit: config.bodyLimit }));

  app.use('/api/docs', docsRouter(buildOpenApiDocument(version)));
  app.use(API_PREFIX, healthRouter(readinessProbes, config.readinessTimeoutMs));

  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}

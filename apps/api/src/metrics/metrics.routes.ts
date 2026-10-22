import { bearerTokenMatches } from '@sitesentinel/shared/node';
import { Router } from 'express';
import { HttpError } from '../http/errors.js';
import type { ApiMetrics } from './metrics.js';

/**
 * Prometheus scrape endpoint. With a token configured, scrapers must send
 * `Authorization: Bearer <token>`; without one, keep the path off the public
 * internet at the ingress instead.
 */
export function metricsRouter(metrics: ApiMetrics, token: string | null): Router {
  const router = Router();

  router.get('/metrics', async (req, res) => {
    if (token && !bearerTokenMatches(req.get('authorization'), token)) {
      res.set('www-authenticate', 'Bearer realm="metrics"');
      throw new HttpError(401, 'Unauthorized', 'A valid metrics token is required');
    }
    res
      .type(metrics.registry.contentType)
      .set('cache-control', 'no-store')
      .send(await metrics.registry.metrics());
  });

  return router;
}

import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import type { OpenApiDocument } from './document.js';

/** Serves the raw document at /openapi.json and Swagger UI at the router root. */
export function docsRouter(document: OpenApiDocument): Router {
  const router = Router();
  router.get('/openapi.json', (_req, res) => {
    res.json(document);
  });
  router.use(
    '/',
    swaggerUi.serve,
    swaggerUi.setup(document, { customSiteTitle: 'SiteSentinel API' }),
  );
  return router;
}

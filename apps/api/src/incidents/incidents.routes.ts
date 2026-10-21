import { Router, type RequestHandler } from 'express';
import { listIncidentsQuerySchema } from '@sitesentinel/shared';
import { currentUserId } from '../auth/auth.middleware.js';
import type { IncidentsService } from './incidents.service.js';

export interface IncidentsRouterDeps {
  incidents: IncidentsService;
  requireAuth: RequestHandler;
}

export function incidentsRouter({ incidents, requireAuth }: IncidentsRouterDeps) {
  const router = Router();
  router.use('/incidents', requireAuth);

  router.get('/incidents', async (req, res) => {
    const query = listIncidentsQuerySchema.parse(req.query);
    res.json(await incidents.list({ userId: currentUserId(res) }, query));
  });

  router.get('/incidents/:id', async (req, res) => {
    res.json(await incidents.get({ userId: currentUserId(res) }, req.params.id));
  });

  return router;
}

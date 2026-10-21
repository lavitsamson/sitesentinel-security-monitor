import { Router, type RequestHandler } from 'express';
import { listRunsQuerySchema, scoreHistoryQuerySchema } from '@sitesentinel/shared';
import { currentUserId } from '../auth/auth.middleware.js';
import type { ResultsService } from './results.service.js';

export interface ResultsRouterDeps {
  results: ResultsService;
  requireAuth: RequestHandler;
}

export function resultsRouter({ results, requireAuth }: ResultsRouterDeps) {
  const router = Router();
  router.use('/sites/:id', requireAuth);

  router.get('/sites/:id/runs', async (req, res) => {
    const query = listRunsQuerySchema.parse(req.query);
    res.json(await results.listRuns({ userId: currentUserId(res) }, req.params.id, query));
  });

  router.get('/sites/:id/runs/latest', async (req, res) => {
    res.json(await results.latestRuns({ userId: currentUserId(res) }, req.params.id));
  });

  router.get('/sites/:id/score-history', async (req, res) => {
    const { days } = scoreHistoryQuerySchema.parse(req.query);
    res.json(await results.scoreHistory({ userId: currentUserId(res) }, req.params.id, days));
  });

  return router;
}

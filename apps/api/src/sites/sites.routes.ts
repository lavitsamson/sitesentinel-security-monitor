import { Router, type Request, type RequestHandler, type Response } from 'express';
import {
  createSiteSchema,
  listSitesQuerySchema,
  updateSiteSchema,
  verifySiteSchema,
} from '@sitesentinel/shared';
import { currentUserId } from '../auth/auth.middleware.js';
import type { Actor, SitesService } from './sites.service.js';

export interface SitesRouterDeps {
  sites: SitesService;
  requireAuth: RequestHandler;
  verifyRateLimit: RequestHandler;
}

const actorOf = (req: Request, res: Response): Actor => ({
  userId: currentUserId(res),
  ip: req.ip,
});

export function sitesRouter({ sites, requireAuth, verifyRateLimit }: SitesRouterDeps) {
  const router = Router();
  router.use('/sites', requireAuth);

  router.get('/sites', async (req, res) => {
    res.json(await sites.list(actorOf(req, res), listSitesQuerySchema.parse(req.query)));
  });

  router.post('/sites', async (req, res) => {
    const site = await sites.create(actorOf(req, res), createSiteSchema.parse(req.body));
    res.status(201).location(`${req.baseUrl}/sites/${site.id}`).json(site);
  });

  router.get('/sites/:id', async (req, res) => {
    res.json(await sites.get(actorOf(req, res), req.params.id));
  });

  router.patch('/sites/:id', async (req, res) => {
    const patch = updateSiteSchema.parse(req.body);
    res.json(await sites.update(actorOf(req, res), req.params.id, patch));
  });

  router.delete('/sites/:id', async (req, res) => {
    await sites.remove(actorOf(req, res), req.params.id);
    res.status(204).end();
  });

  router.post('/sites/:id/verify', verifyRateLimit, async (req: Request<{ id: string }>, res) => {
    // An empty body is fine: both methods are tried.
    const { method } = verifySiteSchema.parse(req.body ?? {});
    res.json(await sites.verify(actorOf(req, res), req.params.id, method));
  });

  return router;
}

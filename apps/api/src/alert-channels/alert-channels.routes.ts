import { Router, type Request, type RequestHandler, type Response } from 'express';
import {
  createAlertChannelSchema,
  listAlertChannelsQuerySchema,
  updateAlertChannelSchema,
} from '@sitesentinel/shared';
import { currentUserId } from '../auth/auth.middleware.js';
import type { Actor } from '../sites/ownership.js';
import type { AlertChannelsService } from './alert-channels.service.js';

export interface AlertChannelsRouterDeps {
  channels: AlertChannelsService;
  requireAuth: RequestHandler;
  testRateLimit: RequestHandler;
}

const actorOf = (req: Request, res: Response): Actor => ({
  userId: currentUserId(res),
  ip: req.ip,
});

export function alertChannelsRouter({
  channels,
  requireAuth,
  testRateLimit,
}: AlertChannelsRouterDeps) {
  const router = Router();
  router.use('/alert-channels', requireAuth);

  router.get('/alert-channels', async (req, res) => {
    const query = listAlertChannelsQuerySchema.parse(req.query);
    res.json(await channels.list(actorOf(req, res), query));
  });

  router.post('/alert-channels', async (req, res) => {
    const channel = await channels.create(
      actorOf(req, res),
      createAlertChannelSchema.parse(req.body),
    );
    res.status(201).location(`${req.baseUrl}/alert-channels/${channel.id}`).json(channel);
  });

  router.get('/alert-channels/:id', async (req, res) => {
    res.json(await channels.get(actorOf(req, res), req.params.id));
  });

  router.patch('/alert-channels/:id', async (req, res) => {
    const patch = updateAlertChannelSchema.parse(req.body);
    res.json(await channels.update(actorOf(req, res), req.params.id, patch));
  });

  router.delete('/alert-channels/:id', async (req, res) => {
    await channels.remove(actorOf(req, res), req.params.id);
    res.status(204).end();
  });

  router.post(
    '/alert-channels/:id/test',
    testRateLimit,
    async (req: Request<{ id: string }>, res) => {
      res.status(202).json(await channels.test(actorOf(req, res), req.params.id));
    },
  );

  return router;
}

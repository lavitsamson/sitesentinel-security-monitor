import { Router, type Request, type RequestHandler } from 'express';
import { currentUserId } from '../auth/auth.middleware.js';
import type { ReportsService } from './reports.service.js';

export interface ReportsRouterDeps {
  reports: ReportsService;
  requireAuth: RequestHandler;
  reportRateLimit: RequestHandler;
}

export function reportsRouter({ reports, requireAuth, reportRateLimit }: ReportsRouterDeps) {
  const router = Router();

  router.get(
    '/sites/:id/report.pdf',
    requireAuth,
    reportRateLimit,
    async (req: Request<{ id: string }>, res) => {
      const { filename, pdf } = await reports.siteReport(
        { userId: currentUserId(res) },
        req.params.id,
      );
      res
        .status(200)
        .type('application/pdf')
        .set({
          'content-disposition': `attachment; filename="${filename}"`,
          // The report holds the owner's private results: never cache it on the way.
          'cache-control': 'private, no-store',
        })
        .send(pdf);
    },
  );

  return router;
}

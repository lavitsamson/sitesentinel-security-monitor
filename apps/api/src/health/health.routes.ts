import { Router } from 'express';
import type { HealthLive } from '@sitesentinel/shared';
import { checkReadiness, type DependencyProbe } from '@sitesentinel/shared/node';

export function healthRouter(probes: Record<string, DependencyProbe>, timeoutMs: number): Router {
  const router = Router();

  // Liveness: the process is up and the event loop responds. No dependency checks,
  // so a database outage never makes the orchestrator restart healthy instances.
  router.get('/health/live', (_req, res) => {
    const body: HealthLive = { status: 'ok' };
    res.json(body);
  });

  // Readiness: can this instance serve traffic right now?
  router.get('/health/ready', async (_req, res) => {
    const report = await checkReadiness(probes, timeoutMs);
    res.status(report.status === 'ok' ? 200 : 503).json(report);
  });

  return router;
}

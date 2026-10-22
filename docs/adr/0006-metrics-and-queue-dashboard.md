# 0006: Metrics per process, and an operator-only queue dashboard

- **Status:** Accepted
- **Date:** 2026-10-22

## Context

Milestone 7 adds Prometheus metrics ("jobs processed, job duration, failures") and Bull Board. Two questions needed an answer:

- **Where do job metrics come from?** Jobs run in the worker, which until now had no HTTP server. The API has one, but it never sees a job run.
- **Who may open Bull Board?** The board can retry, promote, clean and delete jobs, and shows job payloads (site ids, incident ids). Accounts are single-user and have no admin role, and the access cookie is scoped to `/api`, so a user session can't reach `/admin/queues` anyway.

## Decision

**Each process exposes the metrics it can measure directly.**

| Endpoint                   | Metrics                                                                                                                                 |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| API `GET /api/v1/metrics`  | `sitesentinel_http_requests_total` and `_request_duration_seconds` by method and route template; `sitesentinel_queue_jobs{queue,state}` |
| Worker `GET :9464/metrics` | `sitesentinel_jobs_processed_total{queue,outcome}`, `sitesentinel_job_duration_seconds{queue,outcome}`, `sitesentinel_check_runs_total` |
| Both                       | Node.js process metrics (CPU, memory, event-loop lag, GC)                                                                               |

- **Job metrics are recorded in the worker,** around each processing attempt, with an `outcome` of `completed`, `retry` (failed, will be retried), `failed` (failed on its last attempt) or `delayed` (a busy domain parked it without using an attempt). The `retry`/`failed` split is what an alert wants: retries are expected, final failures are not. A small `node:http` server serves them, plus `/health/live` for orchestrator probes (milestone 9). Prometheus scrapes every replica and sums.
- **Queue depth is read by the API from Redis at scrape time** (`getJobCounts`). Queue depth is a property of the cluster, not of a replica: reported by every worker it would be counted once per replica.
- **Labels use route templates** (`/api/v1/sites/:id`), never raw paths, so cardinality stays bounded. Requests that never reached a handler (404s, 401s from the auth middleware) share `route="unmatched"`.
- **Each app builds its own `Registry`**, not the library's global one, so tests can create many apps in one process.
- **Scrapes can require a bearer token** (`METRICS_TOKEN`, compared in constant time). Without one, the deployment keeps the paths off the public internet (milestone 9 ingress).

**Bull Board is an operator tool, not a user feature.** It is mounted at `/admin/queues` only when `BULL_BOARD_PASSWORD` is set, and never in production unless `BULL_BOARD_ENABLED=true`. Access is HTTP Basic with credentials from the environment:

- credentials are compared in constant time, both always compared;
- failed attempts are rate-limited (10 per 15 minutes per source);
- because browsers attach cached Basic credentials to cross-site requests, state-changing requests must come from the board's own pages (Fetch Metadata `Sec-Fetch-Site: same-origin`, or a matching `Origin` where the browser doesn't send it);
- responses are `no-store`, and the board runs under the API's normal helmet CSP (it needs no inline scripts).

## Consequences

- The worker listens on a port. It serves only `GET /metrics` and `GET /health/live`, and `WORKER_METRICS_PORT=0` turns it off.
- Two scrape targets instead of one; a Kubernetes `ServiceMonitor` (or scrape config) lists both.
- A Redis outage leaves the queue-depth series out of the API's scrape rather than failing it, so HTTP metrics keep flowing; alert on the series being absent.
- Board traffic is not in the HTTP metrics (it polls every few seconds and is not API traffic).

## Alternatives considered

- **All metrics in the API, using BullMQ's built-in metrics** (`worker.metrics`, read with `queue.getMetrics`). One scrape target, but BullMQ only keeps completed/failed counts per minute: no durations, no retry/final split, no check results.
- **Push from the worker (Pushgateway).** Meant for short-lived batch jobs; for long-running workers it hides restarts and keeps stale series.
- **An admin role on user accounts for Bull Board.** Accounts are single-user by design (teams are out of scope), and widening the access cookie to `/` to reach `/admin` would send it with every request. An operator credential is simpler and keeps user sessions out of the operations surface.

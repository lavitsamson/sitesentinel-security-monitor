# Progress

Milestones are worked one at a time; each ends green in CI.

## 1. Foundation ✅

- [x] pnpm workspace monorepo (`apps/*`, `packages/*`) with supply-chain guard (`minimumReleaseAge` 14 days, exact pins, opt-in install scripts)
- [x] Tooling: TypeScript strict, ESLint (flat config), Prettier, Husky + lint-staged, commitlint
- [x] `packages/config`: shared tsconfig, ESLint, Prettier and Jest presets
- [x] `packages/shared`: domain enums, Problem Details and health schemas, graceful-shutdown helper
- [x] `packages/checks`: framework-free check contracts with injected dependencies
- [x] API skeleton: config validation, pino with request ids and redaction, helmet, strict CORS, body limit, RFC 9457 errors, `/api/v1/health/live` + `/health/ready`, OpenAPI 3.1 + Swagger UI at `/api/docs`
- [x] Worker skeleton: config, Mongo/Redis connections, graceful shutdown
- [x] Web skeleton: Vue 3 + Vite + Vuetify + Router + Pinia, light/dark theme, API status card
- [x] docker-compose: MongoDB, Redis, Mailpit
- [x] CI: lint → format → typecheck → unit → integration → build
- [x] README skeleton, architecture doc, ADR 0001

## 2. Auth & sites ✅

- [x] Register / login / refresh (rotation + reuse detection) / logout / me / forgot + reset password
- [x] argon2id, httpOnly SameSite=Strict cookies, `X-Requested-With` CSRF check, Redis-backed rate limits (login, register, reset, verify)
- [x] Sites CRUD with ownership guards (other users' resources → 404), cursor pagination, filters, sorting, audit log
- [x] Domain verification (DNS TXT + well-known file), through the SSRF guard
- [x] `safeFetch` SSRF guard + ADR 0002 (pulled forward from milestone 3: verification is the first outbound request)
- [x] Demo seed (`pnpm seed`)
- [x] Web: sign in, register, forgot / reset password, session refresh, route guards

## 3. Checks package ✅

- [x] TLS, security headers, HTTPS redirect, email DNS, security.txt, uptime, each with a plain-English recommendation per finding
- [x] Scoring and grades in `packages/shared/src/scoring.ts` (check weights, severity penalties, header points, A–F)
- [x] `runCheck` wrapper (failures become `ERROR` runs) and `siteStatusFromUptime` (DOWN after 2 consecutive failures)
- [x] `safeConnect` (TLS) on the same address policy, tested against a local TLS server (`safeFetch` and ADR 0002 landed in milestone 2)
- [x] 95% coverage gate on `packages/checks`

## 4. Workers ✅

- [x] `packages/db`: Mongoose models shared by the API and the worker (ADR 0003), plus `checkRuns` (90-day TTL) and `incidents`
- [x] BullMQ queues and a once-a-minute job-scheduler tick; deterministic job ids and per-site jitter (ADR 0004)
- [x] Check processor: per-domain Redis lock, retries with backoff, ERROR runs on the last attempt, size-capped evidence
- [x] Site summary (score, grade, UP/DOWN/DEGRADED) and incident open/resolve on state changes
- [x] Weekly re-verification; 3 failures in a row pause the site, revoke verification and email the owner
- [x] `POST /sites/:id/check-now` (1 per site per 5 minutes) and `POST /sites/bulk` (check now, pause, resume, delete, tag)
- [x] Results API: runs, latest runs, daily score history, incidents
- [x] Graceful shutdown (in-flight jobs finish on SIGTERM)
- [x] Demo seed: 30 days of labelled run history and open/resolved incidents
- Alert delivery on incident transitions lands in milestone 6

## 5. Frontend ✅

- [x] Signed-in navigation (Dashboard, Sites, Incidents); responsive drawer
- [x] Dashboard: KPI cards, grade distribution donut, sites needing attention, open incidents, recent changes (`GET /sites/summary`)
- [x] Sites table: server-side cursor pagination, grade/status/tag filters, sorting, multi-select bulk actions (check now, pause, resume, tag, delete) with skip reasons
- [x] Add-site wizard: domain → verification method → copy token → verify, with per-method failure details; resumable for unverified sites
- [x] Site detail: grade, per-check cards with findings and recommendations, 30-day score trend, response-time chart, run history, check now (with polling), pause/resume, settings, delete
- [x] Incidents page (open / resolved / all, load more); incidents carry their site name
- [x] Pinia stores per domain (`auth`, `sites`, `incidents`); loading, empty and error states on every page; light/dark charts
- [x] Vitest: stores, wizard, findings rendering, bulk actions, formatting
- PDF download lands with its API in milestone 7

## 6. Alerts ✅

- [x] Alert channels API: CRUD with cursor pagination and ownership checks (other users' channels → 404), at most 10 per account, audit log
- [x] Webhook signing secrets: generated per channel, shown once, AES-256-GCM encrypted at rest (`ALERT_SECRET_KEY`)
- [x] Email and HMAC-SHA256-signed webhook delivery (Slack-compatible `text`), through the SSRF guard with redirects disabled; internal webhook hosts refused on save
- [x] Alerts only on incident open/resolve; deterministic job ids and per-channel delivery records, so retries reach only failed channels and nobody is alerted twice (ADR 0005)
- [x] Test send (`POST /alert-channels/:id/test`, 3 per channel per 5 min) and per-channel last delivery status
- [x] Account settings: `PATCH /auth/me` (name, email alert mute) and `POST /auth/change-password` (ends other sessions)
- [x] Web: alert channels page (add, edit, pause, delete, one-time secret, test with live outcome) and settings page
- [x] Demo seed: a labelled email channel for the demo inbox

## 7. Reports & metrics ✅

- [x] `GET /sites/:id/report.pdf`: one-page PDF (pdfkit) with grade, per-check results, 30-day score trend, open incidents and findings with recommendations; owner-scoped, rate-limited, never cached
- [x] Web: "Report (PDF)" download on site detail, through the API client so expired sessions refresh
- [x] API metrics at `/api/v1/metrics`: HTTP requests and durations by route template, queue depth by state, process metrics
- [x] Worker metrics on `:9464/metrics`: jobs processed by outcome (completed, retry, failed, delayed), job duration, check runs by type and status; `/health/live` on the same port
- [x] Optional bearer token for both metrics endpoints (`METRICS_TOKEN`)
- [x] Bull Board at `/admin/queues`: operator Basic auth, wrong-password rate limit, same-origin check on mutations, off in production by default (ADR 0006)
- `prom-client` is deprecated upstream; its successor `@prometheus-io/client` (same project, now in the prometheus GitHub org) is used instead

## 8. Hardening ✅

- [x] Security review against §13 and the OWASP API Top 10; threat model with mitigations and tests in `docs/SECURITY.md`
- [x] Fixed: quadratic regex in the security.txt parser on server-controlled content; client IPs bounded before the IPv6 parser (GHSA-rxp7-6hxx-x8q5, pin the patched `ip-address` once it is 14 days old)
- [x] Simulated network (`SIMULATED_NETWORK`, refused in production) so E2E runs the real checks offline (ADR 0007)
- [x] Playwright suite: the §12 journey (through to the alert email in Mailpit), auth, bulk actions, ownership isolation, keyboard-only use, phone-width navigation; CI job against docker-compose
- [x] Accessibility: axe WCAG 2.2 AA scans of every page, dialog and menu in both themes; fixed light-theme contrast, link-list semantics and Tab order, chart names, dialog focus return, and an unreachable tooltip
- [x] Performance: `pnpm seed:perf` (2,000 sites / 1M runs) and `pnpm perf:bench`; sites list p95 ≤ 15 ms against a 300 ms target; index rationale in `docs/PERFORMANCE.md`

## 9. Kubernetes ✅

- [x] Container images from one multi-stage `Dockerfile` (api, worker, web): digest-pinned bases, `pnpm deploy --prod`, non-root, root-owned app files; the SPA on nginx-unprivileged with CSP and cache headers (pulled forward from milestone 10: kind needs images)
- [x] `k8s/base`: Deployments, Services, Ingress (`/api` → api, `/` → web), ConfigMap and Secret references, startup/liveness/readiness probes, requests and limits, PodDisruptionBudgets
- [x] Worker HPA on CPU (1–5 replicas, slow scale-down; pods drain in-flight jobs within a 45 s grace period)
- [x] Worker `/health/ready` (MongoDB and Redis) on the metrics port; readiness check shared via `@sitesentinel/shared/node`, Mongo probe via `@sitesentinel/db`
- [x] Pod Security "restricted": non-root, read-only root filesystem, no capabilities, RuntimeDefault seccomp, no service-account tokens; each process gets only its secret keys
- [x] NetworkPolicies: default deny; api and worker egress limited to DNS, datastores and public addresses on 80/443 (a network-level copy of the SSRF guard)
- [x] `k8s/overlays/local`: in-cluster MongoDB, Redis and Mailpit, a demo seed Job, generated secrets
- [x] kind: pinned node image, Traefik ingress controller (ingress-nginx is retired), metrics-server; `make kind-up` / `kind-smoke` / `kind-down`
- [x] CI job: build images, deploy to kind, smoke-test through the ingress (including the network policies)
- [x] `docs/DEPLOYMENT.md`, ADR 0008 (why workers scale separately)

## 10. Release

- [ ] api/worker/web in docker-compose, deploy, screenshots, README polish

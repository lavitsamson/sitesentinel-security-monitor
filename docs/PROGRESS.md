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
- PDF download (milestone 7) and alert channels / settings pages (milestone 6) land with their APIs

## 6. Alerts

- [ ] Email + signed webhooks, alert-on-change, test send

## 7. Reports & metrics

- [ ] PDF report, Prometheus metrics, Bull Board

## 8. Hardening

- [ ] Security review, `docs/SECURITY.md`, accessibility pass, Playwright suite, performance check

## 9. Kubernetes

- [ ] kustomize manifests, kind script, `docs/DEPLOYMENT.md`, ADR on separate worker scaling

## 10. Release

- [ ] Production Dockerfiles, deploy, screenshots, README polish

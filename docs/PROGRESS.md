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

## 3. Checks package

- [ ] TLS, security headers, HTTPS redirect, email DNS, security.txt, uptime
- [ ] Scoring and grades
- [ ] `safeConnect` (TLS) on the same address policy (`safeFetch` and ADR 0002 landed in milestone 2)

## 4. Workers

- [ ] BullMQ queues, scheduler, deterministic job ids, run storage, incidents, check-now
- [ ] Bulk site actions (`POST /sites/bulk`), weekly re-verification (pause after 3 failures)

## 5. Frontend

- [ ] Dashboard, sites table with bulk actions, add-site wizard, site detail with charts

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

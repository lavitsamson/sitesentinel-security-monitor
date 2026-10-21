# Architecture

## Overview

```mermaid
flowchart LR
  user([Browser]) --> web[Web SPA<br/>Vue 3 + Vuetify]
  web -->|/api/v1| api[API<br/>Express]
  api --> mongo[(MongoDB)]
  api --> redis[(Redis)]
  scheduler[Scheduler] -->|enqueue due checks| redis
  redis -->|BullMQ jobs| worker[Workers]
  worker --> mongo
  worker --> guard{{SSRF guard<br/>safeFetch / safeConnect}}
  guard -->|passive HTTPS, TLS, DNS| internet((Verified domains))
  worker -->|alerts| mail[SMTP / signed webhooks]
```

The scheduler, workers and alerts are built in milestones 3–6; the SSRF guard already exists (milestone 2). See [PROGRESS.md](PROGRESS.md).

## Packages

| Package           | Responsibility                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| `apps/web`        | Vue 3 SPA. Talks only to the API, same-origin via the Vite proxy in development.                |
| `apps/api`        | REST API. Auth, ownership checks, validation, OpenAPI. Outbound traffic: ownership proofs only. |
| `apps/worker`     | BullMQ consumers + scheduler. Runs checks, stores runs, opens/resolves incidents, sends alerts. |
| `packages/shared` | zod schemas, enums and types shared by all apps. `./node` subpath for server-only helpers.      |
| `packages/checks` | Pure checks, ownership verification and the SSRF-guarded HTTP client. No framework or DB code.  |
| `packages/config` | Shared tsconfig, ESLint, Prettier and Jest presets.                                             |

Why it's split this way: [ADR 0001](adr/0001-monorepo-and-package-boundaries.md).

## Cross-cutting conventions

- **Validation:** every input is parsed with a zod schema from `packages/shared`; the same schemas generate the OpenAPI 3.1 document served at `/api/docs`.
- **Errors:** RFC 9457 Problem Details (`application/problem+json`). Unexpected errors return a generic 500 and are logged with the request id.
- **Logging:** pino JSON logs; each request gets an `x-request-id` (a safe caller-supplied value is honoured). Credentials, cookies and secrets are redacted.
- **Health:** `/api/v1/health/live` checks only the process (no dependencies, so a database outage never restarts healthy pods). `/api/v1/health/ready` probes MongoDB and Redis in parallel with a per-probe timeout and returns 503 naming the failing dependency.
- **Shutdown:** on SIGTERM each process stops accepting work, finishes in-flight work, closes connections in order, and force-exits after a deadline.
- **Configuration:** environment variables only, validated at startup (all problems reported at once). Documented in [`.env.example`](../.env.example).

## Authentication

```mermaid
sequenceDiagram
  participant B as Browser (SPA)
  participant A as API
  participant M as MongoDB
  B->>A: POST /auth/login (email, password)
  A->>M: find user, argon2id verify
  A->>M: store sha256(refresh token), new family
  A-->>B: Set-Cookie ss_access (JWT, 15 min, path /api)<br/>Set-Cookie ss_refresh (opaque, 30 d, path /api/v1/auth)
  B->>A: GET /sites (cookie)
  A-->>B: 401 once the access token expires
  B->>A: POST /auth/refresh (single-flight in the client)
  A->>M: atomically revoke old token, issue next in family
  A-->>B: new cookies → client retries the original request
  Note over A,M: A rotated token presented again = theft → revoke the whole family
```

Both cookies are `httpOnly` and `SameSite=Strict`; mutating requests also need `X-Requested-With` (CSRF). Details: [SECURITY.md](SECURITY.md).

## Domain verification

Adding a site returns a random token. `POST /sites/:id/verify` proves ownership by either:

- a DNS TXT record `sitesentinel-verify=<token>` on the domain, or
- `https://<domain>/.well-known/sitesentinel-verify.txt` containing the token, fetched **without following redirects** so another host can't vouch for the domain.

The verifier lives in `packages/checks` with injected DNS and HTTP. The API calls it synchronously (the user is waiting), rate-limited per user, and its HTTP goes through the SSRF guard ([ADR 0002](adr/0002-ssrf-protection.md)). Weekly re-verification moves to the worker in milestone 4.

## Pagination

Lists use keyset (cursor) pagination: `sort` field plus `_id` as a tie-breaker, with an index per sortable field that starts with `ownerId`. Cursors are opaque base64url, bound to their sort, and handle `null` values (unscored or never-checked sites) explicitly, so pages never skip or repeat rows.

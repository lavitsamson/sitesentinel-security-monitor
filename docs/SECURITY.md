# Security

The full threat model (SSRF, IDOR, token theft, alert spoofing, abuse of the checker against third parties) is written in milestone 8. This page lists the controls in place so far.

## Ethical boundary

Passive checks only, and only on domains whose ownership has been proven (DNS TXT record or a file on the site). Unverified sites are never checked. Demo sites are seeded as pre-verified, labelled "demo data", and checked once a day.

## Authentication and sessions

- **Passwords:** argon2id at the OWASP baseline (19 MiB, t=2, p=1). Length 12–128; the upper bound stops a cheap CPU-exhaustion request.
- **Account enumeration:**
  - Login returns one generic 401 and verifies a dummy hash when the email doesn't exist, so timing doesn't leak accounts.
  - Forgot-password always answers 202, and the email is sent in the background.
  - Registration does report a duplicate email (409); that is a usability trade-off, bounded by its rate limit.
- **Tokens:**
  - Access: a 15-minute HS256 JWT. The algorithm is pinned, and issuer and audience are checked.
  - Refresh: an opaque 256-bit random value, stored only as a SHA-256 hash, valid 30 days.
- **Cookies:** both tokens are `httpOnly` and `SameSite=Strict`, and `Secure` in production. The refresh cookie is scoped to `/api/v1/auth`, so it isn't sent anywhere else.
- **Refresh rotation with reuse detection:**
  - Every refresh claims the old token atomically (`findOneAndUpdate … revokedAt: null`) and issues a new one in the same family.
  - Presenting an already-rotated token is treated as theft: the whole family is revoked. Two concurrent refreshes with one token can't both succeed.
  - The web client single-flights its refresh calls so normal use never triggers this.
- **Password reset:** single-use, 60-minute, hashed tokens. A successful reset revokes every session of the user.
- **Password change:** requires the current password, so a stolen session alone cannot take over the account. Every other session is revoked and the caller gets a fresh one. A wrong current password is a 400 (not 401), so it never triggers a session refresh.

## Request protection

- **CSRF:**
  - `SameSite=Strict` cookies.
  - Every mutating request must carry an `X-Requested-With` header. A cross-site page can't add custom headers without a CORS preflight, and CORS allows only the web origin.
- **Rate limits** (Redis-backed, shared across instances, RFC `RateLimit` headers):

  | Endpoint                | Limit                         |
  | ----------------------- | ----------------------------- |
  | Login                   | 5/min per IP + email          |
  | Registration            | 10/hour per IP                |
  | Password reset requests | 5 per 15 min per IP           |
  | Ownership verification  | 10 per 10 min per user        |
  | Check now               | 1 per site per 5 min          |
  | Bulk site actions       | 10/min per user               |
  | Test alert              | 3 per channel per 5 min       |
  | Password change         | 5/min per user                |
  | PDF report              | 10/min per user               |
  | Bull Board sign-in      | 10 failures per 15 min per IP |

- **Ownership (IDOR):**
  - Every site, incident and alert channel lookup is `{ _id, ownerId }`.
  - Another user's resource, a non-existent id and a malformed id all return the same 404, so existence never leaks.
  - Tests assert this for every route.
- **Validation:** every body and query is parsed by a zod schema from `packages/shared`. Domains are normalised to punycode, and IP literals, ports, paths and private or reserved names are rejected. Pagination cursors are strictly decoded (no operator injection) and bound to their sort.
- **Open redirects:** the web app follows `?redirect=` only to same-app paths.

## Outbound requests (SSRF)

All outbound HTTP (ownership verification and the checks) goes through `safeFetch`, and TLS handshakes go through `safeConnect`, which applies the same address policy and pinning on port 443. See [ADR 0002](adr/0002-ssrf-protection.md). In short:

- only http(s) on ports 80/443;
- every resolved address must be public (deny-by-default IPv4/IPv6 policy, including mapped and NAT64 forms);
- the connection is pinned to the validated IP (DNS-rebinding safe);
- every redirect is re-validated, with at most 3;
- 5 s connect and 10 s total timeouts, and a 1 MB response cap.

## Alerts

- **Spoofed alerts:** webhook bodies are signed with HMAC-SHA256 over `"<timestamp>.<body>"` with a per-channel 256-bit secret; receivers verify in constant time and reject timestamps older than 5 minutes (replays). The README has verification code.
- **Secrets at rest:** webhook secrets are encrypted with AES-256-GCM (random IV per value, authenticated) under `ALERT_SECRET_KEY` from the environment. The API returns a secret only in the create response; the explicit response schema never includes it afterwards.
- **SSRF through webhook URLs:** users choose the URL, so it is untrusted. It must be `https://` on port 443 with no credentials; literal private IPs and internal names are refused when saved, and every delivery goes through `safeFetch` (public addresses only, IP pinned, no redirects, timeouts). See [ADR 0002](adr/0002-ssrf-protection.md) and [ADR 0005](adr/0005-alert-delivery.md).
- **Abuse as a spam or request cannon:** at most 10 channels per account, test sends limited to 3 per channel per 5 minutes, and incident alerts fire only on state changes.

## Operations endpoints

- **Metrics** (`/api/v1/metrics`, worker `:9464/metrics`) expose counts and timings only, labelled with route templates, never raw paths or ids. With `METRICS_TOKEN` set, both require `Authorization: Bearer <token>` (constant-time comparison); otherwise keep them off the public internet at the ingress.
- **Bull Board** (`/admin/queues`) can retry and delete jobs and shows job payloads, so it's for operators only (see [ADR 0006](adr/0006-metrics-and-queue-dashboard.md)):
  - mounted only when `BULL_BOARD_PASSWORD` (16+ characters) is set, and off in production unless `BULL_BOARD_ENABLED=true`;
  - HTTP Basic credentials from the environment, compared in constant time, with wrong passwords rate-limited;
  - browsers re-send cached Basic credentials on cross-site requests, so state-changing requests must be same-origin (`Sec-Fetch-Site`, falling back to `Origin`);
  - `Cache-Control: no-store`, under the API's normal helmet CSP.
- **PDF reports** carry an owner's private results: owner-scoped like every site route (404 otherwise), sent with `Cache-Control: private, no-store`, and the filename is built from the normalised domain only.

## HTTP hardening and hygiene

- **HTTP:**
  - helmet defaults (CSP, HSTS, `nosniff`, frame protection);
  - `x-powered-by` disabled;
  - strict single-origin CORS;
  - a JSON body size limit;
  - `trust proxy` explicitly configured.
- **Errors:** unexpected errors return a generic RFC 9457 body; details stay in server logs.
- **Logs:** authorization headers, cookies, passwords, tokens, token hashes and secrets are redacted by pino.
- **Audit log:** site create, update, delete and verify (including failed attempts), bulk actions, alert channel create, update, delete and test, profile updates and password changes are recorded with the actor and IP.
- **Supply chain:**
  - pnpm refuses any version published in the last 14 days, and versions are pinned exactly in the lockfile;
  - dependency install scripts are opt-in (`allowBuilds` in `pnpm-workspace.yaml`); argon2 uses its bundled N-API prebuilds.
- **Secrets:** configuration comes from environment variables only. `.env` files are git-ignored, the JWT secret must be at least 32 characters, and `ALERT_SECRET_KEY` must be exactly 32 bytes.

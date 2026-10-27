# Changelog

All notable changes to SiteSentinel. Versions follow [Semantic Versioning](https://semver.org/); release tags (`vX.Y.Z`) publish the container images to GHCR.

## 1.0.0 — 2026-10-27

First release.

### Monitoring

- Six passive checks on verified domains: TLS certificate, HTTP security headers, HTTPS redirect, email DNS (MX, SPF, DMARC), `security.txt` and uptime, each finding with a plain-English recommendation.
- Weighted site score and A–F grade, 30-day trends, incidents that open and resolve on state changes.
- Domain ownership verification by DNS TXT record or well-known file, re-verified weekly.
- Every outbound request goes through one SSRF guard (public addresses only, pinned to the checked IP, every redirect re-validated).

### Product

- Vue 3 dashboard: grade distribution, sites needing attention, open incidents; sites table with server-side pagination, filters and bulk actions; add-site wizard; site detail with charts and run history; incidents; alert channels; settings.
- Email and HMAC-signed, Slack-compatible webhook alerts, sent only on incident open and resolve.
- One-page PDF report per site.

### Operations

- Express API and BullMQ workers as separate processes; deterministic job ids, per-domain locks, graceful shutdown.
- Prometheus metrics from both processes; Bull Board for operators (off in production).
- Container images (multi-stage, non-root, digest-pinned bases), published to GHCR on release tags.
- Deploy with Docker Compose on one host (Caddy with automatic HTTPS) or Kubernetes (kustomize, worker autoscaling, default-deny network policies); a local kind cluster with one command.

### Quality

- Unit and integration tests (Jest, Vitest, mongodb-memory-server, real Redis for BullMQ), Playwright end-to-end journeys against a simulated internet, axe WCAG 2.2 AA scans of every page in both themes.
- CI: lint, typecheck, unit, integration, build, Playwright, and smoke tests of the Compose and kind deployments.
- Security review and threat model in `docs/SECURITY.md`; performance check with 2,000 sites and 1M runs in `docs/PERFORMANCE.md`.

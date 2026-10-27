# 0009: The live demo runs on one host with Docker Compose and Caddy

- **Status:** Accepted
- **Date:** 2026-10-27

## Context

Milestone 10 puts SiteSentinel online as a public demo. [ADR 0008](0008-kubernetes-and-worker-scaling.md) already makes the app deployable to Kubernetes, but a cluster is a lot to pay for and run for a demo with one seeded account and twelve sites checked once a day. The project brief allows "docker-compose on a VPS".

The demo still has to behave like production: HTTPS with HSTS, one origin for the SPA and API (first-party cookies, strict CORS), the same hardened images, no datastore exposed to the internet, and outbound checks that can only come from the worker and API.

## Decision

**One VPS runs `deploy/docker-compose.prod.yml`.** It is the Kubernetes layout translated to Compose, using the same images:

- **Images come from GHCR, by release tag.** Pushing `vX.Y.Z` runs `.github/workflows/release.yml`, which checks the tag against `package.json`, then builds the `api`, `worker` and `web` targets with provenance and an SBOM. Its actions are pinned by commit, because the job can push images. The server only pulls; it never builds. Upgrading or rolling back means changing `SITESENTINEL_VERSION`.
- **Caddy is the edge, in the ingress's place.** `/api/*` goes to the API, everything else to the SPA, and `/admin` is not routed. Given a domain, Caddy gets and renews a Let's Encrypt certificate, redirects HTTP to HTTPS, and adds HSTS. It also strips `Server` and `Via`. One `deploy/Caddyfile` serves both the local stack (`SITE_ADDRESS=:8080`, plain HTTP) and production, so the routing CI tests is the routing that ships.
- **Networks stand in for NetworkPolicies, more coarsely.** MongoDB and Redis are only on an `internal` network: no published ports and no route out. The worker gets a separate egress network, and nothing can connect in to it. Only Caddy publishes ports (80 and 443).
- **Container hardening matches the pods.** The app containers are non-root, with a read-only root filesystem and a tmpfs `/tmp`, all capabilities dropped, `no-new-privileges`, memory limits and healthchecks. `depends_on` waits for healthy dependencies. The worker gets 45 s to drain in-flight jobs on shutdown. Caddy keeps only `NET_BIND_SERVICE`, to bind 80/443.
- **Redis is configured for BullMQ:** append-only persistence and `maxmemory-policy noeviction`.
- **The same stack runs locally** (`docker compose --profile app up`) and in CI, where `scripts/compose-smoke.sh` runs the same front-door checks as the kind smoke test, plus container-level checks (healthy, non-root, read-only, no published app ports).

## Consequences

- One machine is a single point of failure. A reboot or a provider incident takes the demo down until Docker restarts the containers. That's acceptable for a demo; the Kubernetes path (ADR 0008) is the answer when availability matters.
- The datastores live on the same host, so backups are the operator's job. `docs/DEPLOYMENT.md` has a `mongodump` routine. Redis holds only queue state, which the scheduler rebuilds.
- Compose networks are coarser than the cluster's NetworkPolicies. The worker's egress network doesn't limit it to public addresses on 80/443. Inside the process the SSRF guard ([ADR 0002](0002-ssrf-protection.md)) still enforces that, and the host firewall should allow only 22, 80 and 443 in.
- Releases are explicit: CI tests every commit, but only a tag publishes images, and the server runs an exact version.
- The public demo resets nightly. A cron job reruns the seed, which recreates only the demo account, so anything a visitor changes in it is undone.

## Alternatives considered

- **A managed Kubernetes cluster with the existing manifests.** It's the most production-like option and needs nothing new, but it costs far more than a small VPS, and the control plane brings no benefit to a demo. The manifests stay ready for it.
- **The web image's nginx as the edge** (proxying `/api` and terminating TLS). That would put certificate handling into the SPA image, and would make it differ between Kubernetes, where the ingress does this, and Compose. A separate edge keeps the web image identical everywhere.
- **Traefik as the edge** (already the kind ingress controller). It works, but the ACME and routing setup is longer and spread across labels or static files. Caddy needs a dozen lines and does automatic HTTPS by default.
- **A PaaS** (Render, Fly.io, Railway). Less to operate, but each has its own way to define a worker and private networking. The demo would then stop showing the containers, networks and hardening that this project is meant to demonstrate.
- **Building images on the server.** No registry would be needed, but the server would need the source tree and build tools, and what runs would no longer be the tested, tagged artifact.

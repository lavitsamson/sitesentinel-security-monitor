# Deployment

SiteSentinel ships as three container images built from one [`Dockerfile`](../Dockerfile) and published to GHCR on every release tag. They deploy two ways:

- **Docker Compose on one host**: the live demo, behind Caddy with automatic HTTPS ([ADR 0009](adr/0009-single-host-deployment.md)). The same stack runs locally with one command.
- **Kubernetes with kustomize**: tried locally on kind, ready for a managed cluster. Why the worker tier scales on its own is in [ADR 0008](adr/0008-kubernetes-and-worker-scaling.md).

## Images

| Image                 | Target   | Contents                                                        | Runs as       | Port                |
| --------------------- | -------- | --------------------------------------------------------------- | ------------- | ------------------- |
| `sitesentinel-api`    | `api`    | `node dist/main.js` with production dependencies only           | `node` (1000) | 4000                |
| `sitesentinel-worker` | `worker` | `node dist/main.js` with production dependencies only           | `node` (1000) | 9464 (metrics only) |
| `sitesentinel-web`    | `web`    | the built SPA on nginx-unprivileged, with CSP and cache headers | `nginx` (101) | 8080                |

```bash
docker build --target api    -t sitesentinel-api .
docker build --target worker -t sitesentinel-worker .
docker build --target web    -t sitesentinel-web .
```

One shared build stage installs from the lockfile (`--frozen-lockfile`, same supply-chain policy as local installs), builds every package, then `pnpm deploy --prod` copies each Node app with only its runtime dependencies. Base images are pinned by digest. App files are owned by root, so the app user can't modify them, and Node runs as PID 1, where `main.ts` handles SIGTERM for graceful shutdown. `APP_VERSION` (build arg, default `1.0.0`) is reported in the outbound `User-Agent`.

## Releases

Bump `version` in the root `package.json` (and the workspace packages), add a [CHANGELOG](../CHANGELOG.md) entry, then tag:

```bash
git tag v1.0.0 && git push origin v1.0.0
```

[`.github/workflows/release.yml`](../.github/workflows/release.yml) checks that the tag matches `package.json`, builds the three targets with `APP_VERSION` set, and pushes them to `ghcr.io/lavitsamson/sitesentinel-{api,worker,web}`, tagged `1.0.0` and `1.0`, with a provenance attestation and an SBOM. Servers pull these images; nothing is built in production. New GHCR packages are private by default: make them public in each package's settings (or `docker login ghcr.io` on the server with a read-only token) before the first deploy.

## Docker Compose

### Locally: the whole stack in containers

```bash
cp .env.example .env                               # dev-only secrets
docker compose --profile app up -d --build --wait  # + api, worker, web, Caddy
docker compose run --rm seed                       # demo account
```

Open http://localhost:8080 and sign in as `demo@sitesentinel.demo` / `DemoPass123!`. The `app` profile adds the production images to the usual MongoDB, Redis and Mailpit (email still lands in Mailpit on http://localhost:8025), with `NODE_ENV=production`, behind the same [`deploy/Caddyfile`](../deploy/Caddyfile) as production on plain HTTP. Without the profile, `docker compose up -d` starts only the datastores for `pnpm dev`, as before. `bash scripts/compose-smoke.sh` runs the same checks as CI. The kind cluster also uses port 8080, so run one at a time.

| Service | Image                              | Exposed                                                |
| ------- | ---------------------------------- | ------------------------------------------------------ |
| proxy   | `caddy:2.11.7-alpine` (by digest)  | `127.0.0.1:8080`: `/api/*` → api:4000, `/` → web:8080  |
| api     | `sitesentinel-api:local`           | nothing (through the proxy)                            |
| worker  | `sitesentinel-worker:local`        | nothing; metrics and health on 9464 inside the network |
| web     | `sitesentinel-web:local`           | nothing (through the proxy)                            |
| seed    | `sitesentinel-api:local`, run once | n/a                                                    |

Every app container is non-root, read-only with a tmpfs `/tmp`, has all capabilities dropped and `no-new-privileges`, a memory limit and a healthcheck; `depends_on` waits for healthy dependencies.

### Production: one VPS

[`deploy/docker-compose.prod.yml`](../deploy/docker-compose.prod.yml) runs the released images behind Caddy, which obtains and renews a Let's Encrypt certificate for your domain. Any small Linux VPS works (2 vCPU and 2 GB RAM is plenty for the demo).

| Network  | Members                         | Purpose                                                                 |
| -------- | ------------------------------- | ----------------------------------------------------------------------- |
| `edge`   | proxy, api, web                 | Caddy reaches the apps; the API's outbound verification and email       |
| `egress` | worker                          | outbound checks (through the SSRF guard) and email; nothing connects in |
| `data`   | mongo, redis, api, worker, seed | `internal`: no published ports and no route to the internet             |

**1. Prepare the server** (once). Install Docker Engine with the Compose plugin, and open only 22, 80 and 443 in the firewall (e.g. `ufw allow OpenSSH && ufw allow 80,443/tcp && ufw allow 443/udp && ufw enable`). Point the domain's A (and AAAA) record at the server.

**2. Configure.** Only the `deploy/` directory is needed on the server:

```bash
git clone --depth 1 https://github.com/lavitsamson/sitesentinel-security-monitor.git sitesentinel
cd sitesentinel/deploy
cp .env.example .env && chmod 600 .env
# fill in SITE_DOMAIN, SITESENTINEL_VERSION, the three secrets (openssl commands in the file),
# SMTP_URL and MAIL_FROM
```

**3. Start and seed.**

```bash
docker compose up -d --wait
docker compose run --rm seed
```

Then open `https://<SITE_DOMAIN>`. To smoke-test it from anywhere: `BASE_URL=https://<SITE_DOMAIN> bash -c 'source scripts/smoke-http.sh; smoke_http; smoke_finish'` from a checkout.

**Nightly demo reset.** The seed recreates only the demo account (sites, history, incidents, channel and sessions), so visitors' changes to it are undone and other accounts are untouched. As root, `crontab -e`:

```cron
15 3 * * * cd /root/sitesentinel/deploy && docker compose run --rm seed >> /var/log/sitesentinel-seed.log 2>&1
```

**Upgrade or roll back.** Set `SITESENTINEL_VERSION` in `deploy/.env` to the release you want, then:

```bash
docker compose pull && docker compose up -d --wait
```

Compose recreates only the containers whose image changed, so expect a few seconds of downtime (a single host has no rolling updates); the worker drains its in-flight checks first (45 s grace period). Rolling back is the same with the previous version.

**Backups.** MongoDB holds everything that matters; Redis holds only queue state, which the scheduler rebuilds. Keep the `caddy-data` volume too, or Caddy re-issues certificates (rate-limited by Let's Encrypt).

```bash
# nightly, then copy the archive off the server
docker compose exec -T mongo mongodump --archive --gzip --db sitesentinel > "backup-$(date +%F).archive.gz"
# restore
docker compose exec -T mongo mongorestore --archive --gzip --drop < backup-YYYY-MM-DD.archive.gz
```

**Operations.** `docker compose ps` shows health; `docker compose logs -f api worker` follows JSON logs (rotated at 5 × 10 MB per container). Worker metrics: `docker compose exec worker node -e "fetch('http://127.0.0.1:9464/metrics', { headers: { authorization: 'Bearer ' + process.env.METRICS_TOKEN } }).then((r) => r.text()).then(console.log)"`. The API's `/api/v1/metrics` is reachable through Caddy with the bearer token.

## Kubernetes layout

```
k8s/
├── base/                    # the three apps, environment-independent
│   ├── namespace.yaml       # Pod Security "restricted" enforced
│   ├── config.env           # non-secret settings → ConfigMap (content-hashed)
│   ├── api.yaml             # Deployment (2 replicas), Service, PodDisruptionBudget
│   ├── worker.yaml          # Deployment, headless metrics Service, HorizontalPodAutoscaler
│   ├── web.yaml             # Deployment (2 replicas), Service, PodDisruptionBudget
│   ├── ingress.yaml         # /api → api, / → web
│   └── network-policies.yaml
├── overlays/local/          # kind: in-cluster MongoDB/Redis/Mailpit, seed Job, local images
└── kind/
    ├── cluster.yaml         # one node, pinned image, localhost:8080 → ingress
    └── addons/              # Traefik ingress controller, metrics-server
```

### What every app pod gets

| Concern   | Setting                                                                                                                                        |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Probes    | startup + liveness on the live endpoint (no dependency checks); readiness on the ready endpoint (MongoDB and Redis); web uses nginx `/healthz` |
| Resources | requests and limits on every container; the HPA targets 70% of the worker's CPU request                                                        |
| Security  | non-root, read-only root filesystem (an `emptyDir` for `/tmp`), all capabilities dropped, RuntimeDefault seccomp, no service-account token     |
| Secrets   | only the keys each process uses, from the `sitesentinel-secrets` Secret (the worker never receives `JWT_ACCESS_SECRET`)                        |
| Rollouts  | `maxUnavailable: 0`; API and web sleep 5 s in `preStop` so endpoint removal propagates before shutdown; the worker gets 45 s to drain its jobs |
| Placement | spread across nodes (`topologySpreadConstraints`, best effort)                                                                                 |

| Endpoint          | api                    | worker (port 9464) | web        |
| ----------------- | ---------------------- | ------------------ | ---------- |
| Startup, liveness | `/api/v1/health/live`  | `/health/live`     | `/healthz` |
| Readiness         | `/api/v1/health/ready` | `/health/ready`    | `/healthz` |
| Metrics           | `/api/v1/metrics`      | `/metrics`         | n/a        |

### Network policies

All pods start from default deny (ingress and egress), then:

| Policy                    | Allows                                                                                                    |
| ------------------------- | --------------------------------------------------------------------------------------------------------- |
| `allow-dns`               | every pod → kube-dns on 53                                                                                |
| `allow-http-ingress`      | anything → api:4000, web:8080 (the ingress controller)                                                    |
| `allow-worker-metrics`    | anything → worker:9464 (Prometheus; `/metrics` needs the token)                                           |
| `allow-datastore-egress`  | api, worker, seed → TCP 27017, 6379, 25/465/587, 1025                                                     |
| `allow-public-web-egress` | api, worker → **public** IPv4/IPv6 on 80/443; private, loopback, link-local, CGNAT and multicast excluded |

The local overlay adds ingress rules so MongoDB, Redis and Mailpit accept connections only from the pods that use them. The egress rule mirrors the SSRF guard ([ADR 0002](adr/0002-ssrf-protection.md)) at the network layer. It needs a CNI that enforces NetworkPolicy; kind's default does.

## Local cluster (kind)

Prerequisites: Docker, [kind](https://kind.sigs.k8s.io/) v0.33+, kubectl, bash and openssl (Git Bash works on Windows).

```bash
make kind-up      # or: bash scripts/kind-up.sh
make kind-smoke   # or: bash scripts/kind-smoke.sh
make kind-down    # deletes the cluster and its volumes
```

`kind-up` is idempotent; re-run it after a code change. It:

1. creates the `sitesentinel` cluster from `k8s/kind/cluster.yaml` (or reuses it);
2. installs Traefik and metrics-server (`k8s/kind/addons`);
3. builds the three images and loads them into the node (`kind load docker-image`, never pulled);
4. writes `k8s/overlays/local/secrets.env` with random values on first run (gitignored; keys in `secrets.env.example`);
5. applies `k8s/overlays/local`, restarts the apps if they were already running, waits for every rollout, and runs the seed Job (the same demo data as `pnpm seed`).

Then open http://localhost:8080 and sign in as `demo@sitesentinel.demo` / `DemoPass123!`. Demo sites are checked passively once a day, from inside the cluster.

| To…                         | Run                                                                                                                                                       |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| see pods and the autoscaler | `kubectl --context kind-sitesentinel -n sitesentinel get pods,hpa`                                                                                        |
| read emails (Mailpit)       | `kubectl --context kind-sitesentinel -n sitesentinel port-forward svc/mailpit 8025`, then http://localhost:8025                                           |
| follow worker logs          | `kubectl --context kind-sitesentinel -n sitesentinel logs -f deploy/worker`                                                                               |
| scrape worker metrics       | `kubectl ... port-forward svc/worker-metrics 9464`, then `curl -H "Authorization: Bearer $METRICS_TOKEN" localhost:9464/metrics` (token in `secrets.env`) |

`kind-smoke` checks, through the ingress: the app shell and SPA fallback, the CSP header, API readiness, that metrics need the token, that Bull Board isn't routed, demo sign-in and the seeded sites. It also checks worker readiness and the HPA, and runs `fetch` from inside a worker pod to prove the egress policy drops private addresses (the Kubernetes API on 443) and ports it doesn't need. CI runs `kind-up` and `kind-smoke` on every push.

## Kubernetes in production

The base is production-shaped; a production overlay supplies what differs:

| Setting    | How                                                                                                                                                                                                                                |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Images     | `images:` with a release tag or digest (`ghcr.io/lavitsamson/sitesentinel-*` in the base)                                                                                                                                          |
| Secrets    | a `sitesentinel-secrets` Secret with `MONGO_URL`, `REDIS_URL`, `SMTP_URL`, `JWT_ACCESS_SECRET`, `ALERT_SECRET_KEY`, `METRICS_TOKEN`, ideally synced from a secret manager (External Secrets, Sealed Secrets) rather than committed |
| Datastores | managed MongoDB and Redis (Redis with `maxmemory-policy noeviction` and persistence, as BullMQ requires); a real SMTP relay                                                                                                        |
| Ingress    | `ingressClassName`, `host`, and TLS (e.g. cert-manager); add HSTS at the controller                                                                                                                                                |
| Config     | `WEB_ORIGIN` (CORS and email links) and `MAIL_FROM` via a `configMapGenerator` merge; `TRUST_PROXY` = number of proxies in front of the API (1 behind the ingress controller)                                                      |
| Scaling    | API `replicas`; worker HPA `minReplicas`/`maxReplicas` and `WORKER_CONCURRENCY`                                                                                                                                                    |
| Network    | narrow `allow-http-ingress` to the ingress controller's namespace once the controller is known; if DNS goes through NodeLocal DNSCache, allow its address                                                                          |

Not in the cluster on purpose: Bull Board (off in production; reach it with `kubectl port-forward` and `BULL_BOARD_ENABLED=true` on a one-off API pod if needed) and the `SIMULATED_NETWORK` flag (refused when `NODE_ENV=production`).

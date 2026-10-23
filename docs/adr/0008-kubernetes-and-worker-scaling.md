# 0008: Kubernetes deployment, with workers scaled separately from the API

- **Status:** Accepted
- **Date:** 2026-10-23

## Context

Milestone 9 deploys SiteSentinel to Kubernetes (kustomize, tried locally on kind). The three processes have very different load profiles:

| Process | Load driven by                                 | Shape                                                                                                           |
| ------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| web     | page loads                                     | static files, negligible CPU                                                                                    |
| api     | signed-in users clicking around                | short requests; bursts at working hours; argon2 hashing on sign-in is the CPU peak                              |
| worker  | the number of verified sites × check frequency | steady background load that grows with the customer base, not with traffic; each check waits on a remote server |

A site checked every 5 minutes costs 6 checks × 12 per hour = 72 jobs per hour, whether or not anyone is signed in. Ten thousand such sites need the worker tier to grow while the API stays at two replicas.

## Decision

**The worker is its own Deployment with its own HorizontalPodAutoscaler.** The API keeps a fixed replica count (2, for availability) and a PodDisruptionBudget. The worker Deployment omits `replicas` so the HPA owns it, and re-applying the manifests never resets a scaled-out tier.

- **Scaling signal: CPU, at 70% of requests (1–5 replicas).** It needs nothing beyond metrics-server, which every managed cluster has. Each worker runs `WORKER_CONCURRENCY` jobs at once; TLS handshakes, response parsing and scoring are the CPU cost of a check.
- **Scale up fast, down slowly.** Up to 2 pods a minute; down 1 pod per 2 minutes after 5 quiet minutes. A removed pod drains its in-flight jobs first (SIGTERM → `worker.close()`, `SHUTDOWN_TIMEOUT_MS` 30 s, inside a 45 s termination grace period), so a scale-down never loses a check. A job that still outlives the grace period is retried by BullMQ.
- **Any number of workers is safe.** This rests on decisions already made: one scheduler tick per minute across all replicas (a BullMQ job scheduler, not a per-process timer), deterministic job ids, and a per-domain Redis lock ([ADR 0004](0004-scheduling-and-job-ids.md)). Queue depth comes from the API, so it isn't counted once per worker ([ADR 0006](0006-metrics-and-queue-dashboard.md)).
- **Probes.** The worker takes no traffic, but it gets the same three probes as the API on its metrics port: startup and liveness on `/health/live` (process up, no dependency checks, so a Redis blip doesn't restart pods), and readiness on `/health/ready` (Mongo and Redis answer). With `maxUnavailable: 0`, a rollout stops an old worker only after its replacement can reach both.

**One origin through the Ingress.** `/api` goes to the API Service and everything else to the web (nginx) Service, so the browser sees one origin, cookies stay first-party and CORS stays strict. `/admin/queues` is not routed; `/api/v1/metrics` is, behind `METRICS_TOKEN`.

**Least privilege at the pod level.** The namespace enforces the `restricted` Pod Security Standard: every container is non-root, has a read-only root filesystem, drops all capabilities and uses RuntimeDefault seccomp. No pod mounts a service-account token. Each Deployment gets only the secret keys it uses (the worker never sees `JWT_ACCESS_SECRET`).

**NetworkPolicies as a second SSRF layer.** Default deny, then: the api and worker may reach DNS, the datastore ports, and **public** addresses on 80/443 only. Private, loopback, link-local (cloud metadata), CGNAT and multicast ranges are excluded. If the SSRF guard ([ADR 0002](0002-ssrf-protection.md)) ever let a private address through, the network would still drop the packets. `scripts/kind-smoke.sh` proves it from inside a worker pod.

**kind for local clusters, with Traefik as the ingress controller.** The manifests use the standard `networking.k8s.io/v1` Ingress, so any controller works; the local overlay sets `ingressClassName: traefik`. ingress-nginx, the usual kind choice, was retired in March 2026 and gets no more security fixes.

## Consequences

- Capacity planning has two independent knobs: API replicas for user traffic, the worker HPA range (and `WORKER_CONCURRENCY`) for site count.
- CPU is an indirect signal for an I/O-bound worker. A worker waiting on slow sites sits at low CPU while the queue grows, so the HPA under-reacts to a backlog of slow checks. The `sitesentinel_queue_jobs{state="waiting"}` metric already exists; scaling on it is the next step (below).
- Datastores are not in the base. The local overlay runs single-instance MongoDB, Redis and Mailpit in the cluster; a production overlay points the secret URLs at managed services.
- Network policies need a CNI that enforces them (kindnet does since kind v0.24; Calico and Cilium do; some managed defaults need it switched on). Without enforcement the manifests still apply, and the SSRF guard remains the primary control.

## Alternatives considered

- **Workers inside the API process.** Simpler to deploy, but checks would compete with user requests for the event loop, and scaling for site count would scale the API too. Rejected at milestone 1 ([ADR 0001](0001-monorepo-and-package-boundaries.md)); this ADR is where the separation pays off.
- **Scale workers on queue depth (KEDA, or the Prometheus adapter on `sitesentinel_queue_jobs`).** The better signal for this workload, and the planned upgrade. Not the default because it needs an extra cluster component and a Prometheus scrape pipeline; CPU works on any cluster today.
- **A StatefulSet or a single "scheduler" pod.** Not needed: the scheduler tick is a BullMQ job scheduler that any worker may run, so all worker pods are identical and disposable.
- **Helm chart.** More flexible templating, but kustomize is built into `kubectl`, keeps the manifests plain YAML a reviewer can read top to bottom, and covers the one real variation here (local vs production).
- **Gateway API instead of Ingress.** The direction Kubernetes recommends after ingress-nginx's retirement. The milestone asks for an Ingress, which every controller still supports; an `HTTPRoute` is a small swap later.

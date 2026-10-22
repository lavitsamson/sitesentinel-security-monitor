# Architecture Decision Records

Each significant or non-obvious decision is recorded here as a short ADR: context, decision, consequences, alternatives.

| #                                               | Title                                                     | Status   |
| ----------------------------------------------- | --------------------------------------------------------- | -------- |
| [0001](0001-monorepo-and-package-boundaries.md) | Monorepo with a framework-free checks package             | Accepted |
| [0002](0002-ssrf-protection.md)                 | One SSRF guard for every outbound request                 | Accepted |
| [0003](0003-shared-db-package.md)               | Mongoose models in a shared `packages/db`                 | Accepted |
| [0004](0004-scheduling-and-job-ids.md)          | Scheduling with deterministic job ids                     | Accepted |
| [0005](0005-alert-delivery.md)                  | Alert delivery: one job per transition, signed webhooks   | Accepted |
| [0006](0006-metrics-and-queue-dashboard.md)     | Metrics per process, and an operator-only queue dashboard | Accepted |

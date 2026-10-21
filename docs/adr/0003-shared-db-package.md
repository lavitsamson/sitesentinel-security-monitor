# 0003: Mongoose models in a shared `packages/db`

- **Status:** Accepted
- **Date:** 2026-10-21

## Context

Until milestone 4 only the API touched MongoDB, and its models lived in `apps/api/src/models`. The worker now needs most of the same collections. It reads sites and writes run summaries and verification state, it writes check runs and incidents, it writes audit entries for the pauses it makes, and it reads users to email the owner. The API needs the new `checkRuns` and `incidents` collections to serve results.

The planned layout in CLAUDE.md has `shared`, `checks` and `config` packages and no persistence package.

## Decision

Add `packages/db` (`@sitesentinel/db`) containing every Mongoose model, its indexes and its DTO mapper (`toSiteDto`, `toCheckRunDto`, ...), plus `connectMongo` / `disconnectMongo` / `isDuplicateKeyError`. Both apps import models and connect through it.

- `packages/shared` stays free of Mongoose: the web app depends on it, and its schemas are pure zod.
- `packages/checks` stays free of any database (ADR 0001).
- Connecting through the package means the models and the connection always share one `mongoose` instance. Two copies of mongoose would leave models registered on a connection that was never opened.

## Consequences

- One definition of each collection, its indexes and its TTLs, so the schema the worker writes can't drift from the one the API reads.
- Index decisions are reviewable in one place. For example, the scheduler's cross-owner indexes on `sites` sit next to the owner-scoped ones they're an exception to.
- The API and the worker now share a deploy-time dependency on the schema. That is true of the database anyway, and now it shows in the code.

## Alternatives considered

- **Models in `packages/shared`** (or a `./db` subpath of it): pulls Mongoose into the web app's dependency graph and mixes persistence into a package that is otherwise contracts only.
- **Each app defines the models it uses**: duplicated schemas, and two definitions of one collection are a classic source of index and validation drift.
- **The worker calls the API for everything**: adds latency and an availability coupling to every job, and the API would need internal-only endpoints for writes that no user should be able to make.

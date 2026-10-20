# ADR 0001: Monorepo with a framework-free checks package

- **Status:** Accepted
- **Date:** 2026-10-20

## Context

SiteSentinel has three deployables (web SPA, REST API, background workers) that share types, validation schemas and scoring rules. The checks themselves (TLS, headers, DNS…) are the core domain logic and the part most likely to be wrong in subtle ways, so they need to be exhaustively tested, and the tests must never touch the real network.

## Decision

1. **One pnpm workspace** with `apps/{web,api,worker}` and `packages/{shared,checks,config}`.
2. **`packages/shared`** holds zod schemas, enums and types used by every app. The same zod schema validates API input, generates the OpenAPI document and types the web client, so the three cannot drift. A Node-only subpath (`@sitesentinel/shared/node`) keeps server helpers out of the browser bundle.
3. **`packages/checks` is framework-free.** Every check is `(target, deps) => Promise<CheckResult>`, where `deps` injects the HTTP client, DNS resolver, TLS connector and clock. It has no knowledge of Express, BullMQ or MongoDB.
4. **The API and worker are separate processes.** The API stays responsive regardless of check load, and workers can scale independently (see the milestone 9 ADR).
5. **ESM everywhere**, TypeScript strict, compiled with `tsc`. Tests resolve workspace packages to their sources, so no build step is needed before testing.

## Consequences

- Checks are unit-testable with fixtures (expired certificates, weak headers, `+all` SPF) and a fake clock, with no network and no mocks of Node internals.
- The SSRF guard plugs in as the production `HttpClient`/`TlsConnector`, so every outbound request goes through a single choke point.
- Typechecking an app needs the packages built first (`pnpm typecheck` does this). That is a small cost compared with TypeScript project references.
- Cross-package changes land in one commit and one CI run.

## Alternatives considered

- **Polyrepo:** independent versioning isn't needed for one product, and schema drift between repos is exactly the bug class we want to avoid.
- **Turborepo/Nx:** useful at larger scale. pnpm's topological `-r` runs are enough for three apps and keep the toolchain small.
- **Checks inside the worker:** simpler at first, but it couples domain logic to BullMQ and makes isolated testing harder.

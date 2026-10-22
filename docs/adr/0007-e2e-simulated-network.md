# 0007: End-to-end tests against a simulated internet

- **Status:** Accepted
- **Date:** 2026-10-22

## Context

The E2E journey in the brief is: register → add site → verify → run checks → see grade → create alert channel → force failure → incident appears. It crosses the browser, the API, Redis, the worker, MongoDB and SMTP. Every step that matters (verification, the six checks) talks to the internet, and tests must never make real network calls (CLAUDE.md §2).

Unit and integration tests already inject fake HTTP, DNS and TLS clients into the checks. The E2E suite, though, runs the built apps as separate processes, so it can't inject anything in-process. It still needs to:

- prove ownership the way a user does, by publishing a token the UI shows;
- get a real grade from the real check code;
- break a site on demand and watch an incident open.

## Decision

**A simulated internet behind the existing `CheckDeps` interfaces,** in `@sitesentinel/checks/simulated`. It implements the same `HttpClient`, `DnsResolver` and `TlsConnector` the SSRF-guarded clients do:

- Every domain is a well-run site: a 301 to HTTPS, strong headers, a valid security.txt, SPF, DMARC `p=reject`, and a TLS 1.3 certificate valid for 60 more days. So every check runs its real code and the site scores an A.
- Per-domain state lives in Redis (`simulated-network:<domain>`), shared by the API and the worker. The test writes it the way a domain owner would act: publishing a `TXT` record or verification file, or a **fault** (`CERT_EXPIRED`, `DOWN`, `PLAIN_HTTP`).
- Both apps use it only when `SIMULATED_NETWORK=true`, and their config **refuses that in production**. A misconfigured run still can't reach anyone: E2E domains are `*.example.com` (reserved for documentation).

**The suite drives the stack from outside:** the browser, plus Redis (simulated state) and Mailpit's API (to assert the alert email). Playwright always starts the API, worker and web preview itself, from the build, and never reuses a running server, so the flag can't be missing.

**One test-only shortcut, stated as such:** check-now is limited to once per site per 5 minutes, twice over: a rate limit, and job ids shared within the window. To re-check right after forcing a failure, the suite clears the counter and removes that site's finished manual jobs through BullMQ's public API. That is what the window ending would do.

## Consequences

- The E2E journey takes about 20 s and is deterministic, with no flaky DNS, real certificates or third-party outages.
- It exercises the real check, scoring, incident and alert code paths, not a fake check runner. Only the bottom network layer is swapped.
- The SSRF guard is not on the E2E path. It has its own exhaustive unit tests against real sockets on loopback (ADR 0002).
- One more code path ships in production builds, inert behind a flag that production config rejects.

## Alternatives considered

- **Real public domains in E2E:** network calls in tests, flaky, and against the project's rules.
- **A local DNS server and HTTPS servers with a test CA:** the most realistic option, but the SSRF guard (rightly) refuses loopback and private addresses. Making it allow them in tests would weaken exactly the code we most want unchanged.
- **Stubbing at the HTTP API (Playwright route mocking):** it would only fake the browser's view. Checks run in the worker, so nothing real would be tested.
- **A "fake check runner" returning canned results:** simpler, but the scoring and findings shown in the UI would be invented rather than produced by the checks.

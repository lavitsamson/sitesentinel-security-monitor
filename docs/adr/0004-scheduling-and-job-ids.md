# 0004: Scheduling with deterministic job ids

- **Status:** Accepted
- **Date:** 2026-10-21

## Context

Every verified site needs each of its six checks run every 5, 15, 60 or 1440 minutes. The scheduler must:

- never run the same check twice for one cycle, even when it ticks again before the previous jobs have run (a backlog), when several worker replicas run, or when a user presses "check now" during a scheduled run;
- not stampede: sites created on the hour, or all sites after a restart, shouldn't all fire in the same second;
- never send a domain more than one request at a time, across all workers;
- keep a transient failure on our side (DNS outage, timeout) from turning into a false incident.

## Decision

**One tick per minute, run by a BullMQ job scheduler** (`upsertJobScheduler`, `every: 60 s`) on a `scheduler` queue. BullMQ keeps exactly one tick per period across all replicas, so the tick is not a per-process `setInterval`. A tick streams every site that is verified, unpaused and due (`lastCheckedAt` at least one interval old, or never checked). The query has one `$or` clause per allowed interval, so it stays on an index. The tick then enqueues one job per check type.

**Deterministic job ids: `<siteId>.<type>.<slot>`.** BullMQ ignores an `add` whose id already exists, so duplicates are impossible rather than unlikely.

- For scheduled checks the slot is the `lastCheckedAt` the job was scheduled from. Every tick until the check completes sees the same value and produces the same id, however long the backlog. Completing a check moves `lastCheckedAt`, and that opens the next slot.
- For check-now (API and bulk) the slot is the 5-minute window (`manual-<n>`), so repeated presses in the window collapse into one job. The route is additionally rate-limited to 1 per site per 5 minutes.
- CLAUDE.md writes the id as `siteId:type:slot`. The parts are joined with `.` because BullMQ reserves `:` in custom ids: 3-part `:` ids are tolerated only for legacy repeatable jobs, and the source notes they will be rejected in a future major version.

**Jitter is deterministic.** Each site's jobs are delayed by a hash of its id, spread across up to 60 s (a tenth of the interval for 5-minute sites). Sites due at the same moment spread out, and each site keeps a steady cadence.

**One check per domain at a time.** The processor takes a Redis lock `lock:domain:<domain>` (`SET NX PX 60s`, released with a compare-and-delete script). If the domain is busy, the job is moved back to delayed for a few seconds (`moveToDelayed` + `DelayedError`). That doesn't consume an attempt.

**Retries.** A check that returns `ERROR` (couldn't run) is retried with exponential backoff (3 attempts: 30 s, 60 s). Only the last attempt stores an `ERROR` run, and ERROR runs are left out of scoring and incident logic. Completed jobs are kept for a day. Failed jobs are kept for an hour only, because a retained failed job blocks its id from being re-added.

**Re-verification** runs on the same tick. A verified, non-demo site is due a week after its last attempt, or a day after a failed one. After 3 failures in a row the site is paused, its verification is revoked (checks stop until the owner re-verifies) and the owner is emailed.

**Incidents follow state changes.** An incident opens when a check moves to FAIL; for UPTIME it opens when the site goes DOWN, which takes two failures in a row. It resolves only when that check returns to PASS. A partial unique index allows one open incident per site and check, so two racing runs can't open two incidents.

## Consequences

- Scheduling is idempotent: ticks can run late, twice or concurrently without double-checking anyone, which also makes the scheduler trivial to test.
- A site whose jobs all fail hard (e.g. MongoDB unavailable while storing the run) is retried by the scheduler once the failed job expires, at most an hour later.
- `lastCheckedAt` is per site, not per check type. All six checks of a cycle share a slot, which is what we want, but a single check type can't be on its own cadence. Nothing in the product needs that.

## Alternatives considered

- **A repeatable job per site**: thousands of schedulers to keep in sync with every interval change, pause and delete. A single tick computed from the database has one source of truth.
- **A `nextCheckAt` claimed atomically by the scheduler**: also prevents duplicates, but needs a write per site per tick and still needs job-id dedupe for check-now.
- **BullMQ Pro groups for per-domain concurrency**: a commercial dependency. A Redis lock does the job.

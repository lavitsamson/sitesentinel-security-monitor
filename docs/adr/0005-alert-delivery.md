# 0005: Alert delivery: one job per transition, signed webhooks

- **Status:** Accepted
- **Date:** 2026-10-22

## Context

When an incident opens or resolves, every active channel of the site's owner (email addresses and webhooks) must hear about it. The requirements pull in different directions:

- **Exactly one alert per change.** A check that keeps failing must not alert again ("no alert storms"), and a retried job, a second worker replica or a crash halfway through a list of channels must not alert anyone twice.
- **At least one alert per change.** A webhook that is down for a few minutes, or an SMTP hiccup, should not swallow the alert.
- **Receivers must be able to trust an alert.** Webhook URLs leak (they're pasted into chat tools and config files), so anyone could POST a fake "incident resolved" to one.
- **Webhook URLs are user input.** Delivering to them is an outbound request to an address an attacker chooses.

## Decision

**Alerts follow incident transitions, not check results.** The check processor already opens an incident only when a check moves to FAIL (or a site goes DOWN) and resolves it only on PASS (ADR 0004). It queues an alert job only when its update actually changed the incident, so repeated failures produce no jobs at all.

**One job per transition, with a deterministic id: `<incidentId>.OPENED` / `<incidentId>.RESOLVED`.** BullMQ ignores an `add` whose id exists, so queueing the same transition twice is a no-op. Finished and failed jobs are kept for a week so the id keeps blocking re-sends.

**One delivery record per channel per transition.** `alertDeliveries` has a partial unique index on `(channelId, incidentId, event)`. The processor upserts the record before sending and skips channels whose record is already `SENT`. A job that fails for some channels throws, BullMQ retries it with exponential backoff (5 attempts; retries after 30 s, 1, 2 and 4 min), and the retry reaches only the channels that are still `PENDING`. On the last attempt the remaining failures are marked `FAILED`. Records expire after 30 days (TTL index).

**Each channel shows its latest outcome** (`lastDelivery: { status, at, error }`), so a broken webhook is visible in the UI without a delivery log page.

**Webhooks are signed with HMAC-SHA256.** Each webhook channel gets a 256-bit secret (`whsec_…`), returned once when the channel is created. The `X-SiteSentinel-Signature` header is `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">`. Signing the timestamp lets receivers reject replays (we suggest a 5-minute tolerance); the `v1=` prefix leaves room to rotate the scheme. The body is JSON with a Slack-compatible `text` field, so a Slack incoming webhook accepts it unchanged.

**Secrets are encrypted at rest** with AES-256-GCM under `ALERT_SECRET_KEY` (an env var shared by the API, which encrypts, and the worker, which decrypts). A random 96-bit IV per value; the stored form is `v1.<iv>.<tag>.<ciphertext>`. GCM authenticates the ciphertext, so a tampered value fails to decrypt instead of producing a wrong key. The API never returns the secret again; to rotate it, delete the channel and add it again.

**Webhook delivery goes through the SSRF guard** (ADR 0002): public addresses only, the socket pinned to the validated IP, 5 s / 10 s timeouts, and **no redirects** (a redirecting webhook counts as a failure). The API also refuses literal private IPs and internal names (`localhost`, single-label hosts, `.local`, `.internal`) when a channel is saved, so obvious mistakes fail at the form. That check is a convenience; the guard at delivery time is the boundary, because DNS can change after the URL is saved.

**Test sends** use the same queue and sender, so a successful test proves the real path works. They are tried once (the user is watching), rate-limited to 3 per channel per 5 minutes, and reported through `lastDelivery`, which the web app polls.

**Owners can mute email** (`notificationPrefs.emailAlerts`) without deleting channels; webhooks are unaffected.

## Consequences

- Once a job is queued, the worst case is a duplicate rather than a loss, and only in a narrow window: a worker that crashes after the receiver accepted a webhook but before the record says `SENT` sends it again on retry. Receivers can de-duplicate on the `X-SiteSentinel-Delivery` header, which is the delivery record's id and is stable across retries.
- Queueing is not transactional with the incident write: if Redis is unreachable at that moment, the failure is logged and that transition is not alerted. A transactional outbox would close the gap; with Redis already required for the check job itself, the window is small enough to accept for now.
- Alerts are only as timely as the queue: an alert waits for a free worker slot like any other job. Alert jobs are tiny, so in practice this is seconds.
- One encryption key for all secrets. Rotating `ALERT_SECRET_KEY` means re-encrypting every channel's secret; the version prefix makes a migration script straightforward, but none exists yet.

## Alternatives considered

- **Sending alerts inline in the check processor**: simpler, but a slow webhook would hold a check worker and the domain lock, and a failed send would need its own retry machinery.
- **One job per channel per transition**: finer-grained retries, but the fan-out would happen at enqueue time, so a channel added between a failure and its retry could never be reached, and the job count grows with channels.
- **Hashing the webhook secret** like a password: impossible here, because the worker needs the plaintext to compute the HMAC.
- **Asymmetric signatures (Ed25519)**: receivers would verify with a public key and nothing secret would be stored, but most webhook consumers (and Slack-style tooling) expect a shared-secret HMAC, and it is simpler to verify.

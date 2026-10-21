# 0002: One SSRF guard for every outbound request

- **Status:** Accepted
- **Date:** 2026-10-21

## Context

SiteSentinel's whole job is to make requests to hostnames that users type in, and later to webhook URLs users supply. That is the textbook setup for **server-side request forgery (SSRF)**. A user could point the checker at `169.254.169.254` (cloud metadata credentials), `localhost:6379` (our own Redis), an internal admin panel, or a public name whose DNS answers with a private address.

Simple defences fail in well-known ways:

- **Checking the hostname string** misses names that _resolve_ to private addresses, plus alternative IP spellings (`2130706433`, `0x7f.1`, `::ffff:127.0.0.1`).
- **Resolving, checking, then letting the HTTP client resolve again** is open to **DNS rebinding**: the attacker's DNS server answers the check with a public IP and the real connection with `127.0.0.1` (TTL 0).
- **Validating only the first URL** lets an allowed site answer `302 Location: http://169.254.169.254/`.

## Decision

All outbound HTTP goes through `createSafeHttpClient` in `packages/checks` (`safeFetch`). TLS handshakes will go through `safeConnect` with the same policy in milestone 3. For **every hop**, the client:

1. **Validates the URL:** only `http:`/`https:`, only ports 80/443, no embedded credentials.
2. **Resolves the host itself** (injected `lookup`) and requires **every** returned address to be public. Mixed public/private answers are refused. IP literals are checked directly, after the WHATWG URL parser has canonicalised odd spellings.
3. **Pins the connection** to the validated address with a custom `lookup` passed to `http.request`. The socket connects to exactly the IP that was checked, and nothing resolves a second time. SNI and `Host` still carry the hostname, so TLS validation is unchanged.
4. **Follows redirects manually**, at most 3, repeating steps 1–3 on each `Location`.
5. **Bounds resources:** 5 s connect timeout, 10 s total deadline (DNS included), and a 1 MB response cap that aborts the stream.
6. **Identifies itself:** `User-Agent: SiteSentinel/<version> (+repo URL)`.

The address policy (`isPublicAddress`) is **deny by default**:

- IPv4: blocks every IANA special-purpose range, including 0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12, 192.168/16, test-nets, benchmarking, multicast and 240/4.
- IPv6: allows only global unicast `2000::/3`, minus documentation, 6to4 and IETF-assignment blocks.
- IPv4-mapped (`::ffff:a.b.c.d`) and NAT64 (`64:ff9b::/96`) addresses are unwrapped and re-checked as IPv4. Scoped addresses (`fe80::1%eth0`) and anything unparseable are refused.

Domain verification uses the same client, with redirects disabled, so a redirect to another host cannot vouch for a domain.

## Consequences

- One small, heavily table-tested module is the only network egress. Reviewing SSRF safety means reviewing one file.
- DNS and the HTTP layer are injected, so tests cover rebinding, redirect-to-metadata and the limits without any real network traffic.
- Sites that are only reachable on non-standard ports, or only over private networks, can't be monitored. That's intended: SiteSentinel monitors public websites.
- Defence in depth for production (milestone 9/10): run workers with an egress network policy that also denies private ranges, so a bug in this module is not the last line.

## Alternatives considered

- **An egress proxy (e.g. Smokescreen)** is excellent in production, but it's another moving part for a local demo, and the in-process guard is still needed to give users clear errors. It's a good later addition, not a replacement.
- **Validate-then-fetch with `fetch()`**: the global `fetch` doesn't expose a per-request `lookup`, so it can't pin the address and stays open to rebinding.
- **Blocklisting hostnames** (`localhost`, `*.internal`) helps with UX (we do it in domain validation too), but it doesn't count as protection on its own.

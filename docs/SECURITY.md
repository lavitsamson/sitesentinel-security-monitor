# Security

The full threat model (SSRF, IDOR, token theft, alert spoofing, abuse of the checker against third parties) is written in milestone 8.

## In place today

- **Ethical boundary:** passive checks only, on verified domains only (enforced from milestones 2–4).
- **HTTP hardening:** helmet defaults (CSP, HSTS, `nosniff`, frame protection), `x-powered-by` disabled, strict single-origin CORS, JSON body size limit.
- **Error hygiene:** unexpected errors return a generic RFC 9457 body; details stay in server logs.
- **Log hygiene:** authorization headers, cookies, passwords, tokens and secrets are redacted by pino.
- **Supply chain:** pnpm refuses any version published in the last 14 days, versions are pinned exactly in the lockfile, and dependency install scripts are opt-in (`allowBuilds` in `pnpm-workspace.yaml`).
- **Secrets:** configuration comes from environment variables only; `.env` files are git-ignored.

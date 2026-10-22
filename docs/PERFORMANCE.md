# Performance

Milestone 8 target: with **2,000 sites and 1M check runs**, the sites list answers with **p95 < 300 ms** locally.

## How to reproduce

```bash
docker compose up -d
# A separate database keeps the dataset away from your dev data.
MONGO_URL=mongodb://localhost:27017/sitesentinel_perf pnpm seed:perf    # about 20 s
pnpm build
# The built API in production mode, pointed at the perf database (another port):
NODE_ENV=production LOG_LEVEL=warn API_PORT=4200 \
  MONGO_URL=mongodb://localhost:27017/sitesentinel_perf \
  node --env-file=.env apps/api/dist/main.js &
API_URL=http://localhost:4200 MONGO_URL=mongodb://localhost:27017/sitesentinel_perf pnpm perf:bench
```

`pnpm seed:perf` creates `perf@sitesentinel.demo` / `DemoPass123!` with 2,000 sites and 500 runs each, spread over 30 days. Every site belongs to **one** user (the worst case for a per-owner list). They are `example.com` subdomains, labelled demo data, and **paused**, so a running worker never checks them. `PERF_SITES` and `PERF_RUNS_PER_SITE` change the size.

`pnpm perf:bench` signs in as that user and sends 200 sequential requests per row, after 5 warm-up requests, through the real HTTP stack (auth, validation, serialisation). It then prints the Mongo query plan behind each sites-list shape.

## Results

Windows 11 laptop, Node 24, MongoDB 8.2 in Docker Desktop, 2026-10-22.

| Request                            |     p50 |     p95 |     max |
| ---------------------------------- | ------: | ------: | ------: |
| Sites, first page (25, by name)    |  5.2 ms |  6.9 ms | 14.8 ms |
| Sites, 100 per page, by score      |  9.3 ms | 14.6 ms | 21.9 ms |
| Sites, by last checked             |  4.7 ms |  6.8 ms | 11.9 ms |
| Sites, filtered by grade           |  4.6 ms |  6.4 ms | 15.8 ms |
| Sites, filtered by status          |  5.3 ms |  8.3 ms | 18.1 ms |
| Sites, filtered by tag             |  4.8 ms |  7.1 ms | 14.7 ms |
| Sites, deep pages (all 20 cursors) |  9.1 ms | 14.4 ms | 20.8 ms |
| Dashboard summary                  | 10.6 ms | 14.1 ms | 24.1 ms |
| Run history (one site)             |  5.9 ms |  7.6 ms | 10.7 ms |
| 30-day score history (one site)    |  9.6 ms | 12.5 ms | 20.1 ms |

The slowest p95 is 14.6 ms, about 20× under the target.

| Sites query          | Index                             | Keys examined | Docs examined | Returned |
| -------------------- | --------------------------------- | ------------: | ------------: | -------: |
| by name              | `ownerId_1_displayName_1__id_1`   |            26 |            26 |       26 |
| by score, desc       | `ownerId_1_currentScore_1__id_1`  |            26 |            26 |       26 |
| by last checked      | `ownerId_1_lastCheckedAt_1__id_1` |            26 |            26 |       26 |
| grade F, by name     | `ownerId_1_displayName_1__id_1`   |            62 |            62 |       26 |
| status DOWN, by name | `ownerId_1_displayName_1__id_1`   |           805 |           805 |       26 |
| tag, by name         | `ownerId_1_tags_1`                |           241 |           241 |       26 |

## Indexes and why

- **Keyset pagination needs no extra work.** Each sort has an `{ ownerId, <sort field>, _id }` index, so a page is a single index range read: 26 keys for 25 rows plus the one-row look-ahead. That holds at any depth, because the cursor is a position in the index, not an offset.
- **Filters walk the sort index.** A filtered list scans the sort index until it has a page, so its cost grows with how rare the value is. The worst case shown is `status=DOWN` (3% of sites): 805 documents to fill a page, still under 10 ms. A filter matching nothing examines all of one owner's sites, at most a few thousand.
- **No status index was added.** `sites` is written on every check result (score, grade, status, last checked), and every index is maintained on each of those writes. At the target size, filtered lists are already fast, so an `{ ownerId, status, … }` index would cost on every write and save under 10 ms per read. Revisit it if accounts grow far past 2,000 sites.
- **Runs** are read by `{ siteId, type, startedAt }` (latest per type, per-type history) and `{ siteId, startedAt, _id }` (run history pages). Both stay per-site, so they don't grow with the 1M total. A TTL index on `startedAt` caps retention at 90 days.
- **The scheduler** finds due sites through `{ paused, checkIntervalMinutes, lastCheckedAt }`, with one clause per interval (ADR 0004).

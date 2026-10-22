import { performance } from 'node:perf_hooks';
import type { Types } from 'mongoose';
import { z } from 'zod';
import {
  SiteModel,
  CheckRunModel,
  connectMongo,
  disconnectMongo,
  UserModel,
} from '@sitesentinel/db';
import { PERF_EMAIL, PERF_PASSWORD } from './perf-data.js';

/**
 * Measures the API against the perf dataset (`pnpm seed:perf`): latency of the
 * sites list and related reads over HTTP, then the Mongo query plan behind each
 * sites-list shape. Prints Markdown, ready for the README. Needs the API running.
 */
const env = z
  .object({
    MONGO_URL: z.string().regex(/^mongodb(\+srv)?:\/\//, 'must be a mongodb:// URL'),
    API_URL: z.url().default('http://localhost:4000'),
    BENCH_REQUESTS: z.coerce.number().int().min(10).max(10_000).default(200),
  })
  .parse(process.env);

const api = `${env.API_URL}/api/v1`;

async function signIn(): Promise<string> {
  const res = await fetch(`${api}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'perf-bench' },
    body: JSON.stringify({ email: PERF_EMAIL, password: PERF_PASSWORD }),
  });
  if (!res.ok) throw new Error(`Sign-in failed (HTTP ${res.status}); run pnpm seed:perf first`);
  return res.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
}

interface Scenario {
  name: string;
  path: () => string;
}

async function time(cookie: string, scenario: Scenario, requests: number) {
  const durations: number[] = [];
  for (let i = 0; i < requests + 5; i++) {
    const started = performance.now();
    const res = await fetch(`${api}${scenario.path()}`, { headers: { Cookie: cookie } });
    await res.arrayBuffer();
    if (!res.ok) throw new Error(`${scenario.name}: HTTP ${res.status}`);
    if (i >= 5) durations.push(performance.now() - started); // first 5 warm up
  }
  durations.sort((a, b) => a - b);
  return {
    p50: percentile(durations, 50),
    p95: percentile(durations, 95),
    max: durations.at(-1) ?? 0,
  };
}

/** Every cursor of the default listing at 100 per page, to time the deepest pages too. */
async function allCursors(cookie: string): Promise<string[]> {
  const cursors: string[] = [];
  let cursor: string | null = null;
  do {
    const query: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
    const res = await fetch(`${api}/sites?limit=100&sort=-score${query}`, {
      headers: { Cookie: cookie },
    });
    const body = (await res.json()) as { pageInfo: { nextCursor: string | null } };
    cursor = body.pageInfo.nextCursor;
    if (cursor) cursors.push(cursor);
  } while (cursor);
  return cursors;
}

async function explain(ownerId: Types.ObjectId) {
  const shapes: { name: string; filter: Record<string, unknown>; sort: Record<string, 1 | -1> }[] =
    [
      { name: 'by name', filter: {}, sort: { displayName: 1, _id: 1 } },
      { name: 'by score, desc', filter: {}, sort: { currentScore: -1, _id: -1 } },
      { name: 'by last checked', filter: {}, sort: { lastCheckedAt: -1, _id: -1 } },
      { name: 'grade F, by name', filter: { currentGrade: 'F' }, sort: { displayName: 1, _id: 1 } },
      {
        name: 'status DOWN, by name',
        filter: { status: 'DOWN' },
        sort: { displayName: 1, _id: 1 },
      },
      { name: 'tag, by name', filter: { tags: 'client-c' }, sort: { displayName: 1, _id: 1 } },
    ];
  const rows: string[] = [];
  for (const shape of shapes) {
    const plan = (await SiteModel.find({ ownerId, ...shape.filter } as Record<string, unknown>)
      .sort(shape.sort)
      .limit(26)
      .explain('executionStats')) as unknown as {
      queryPlanner: { winningPlan: unknown };
      executionStats: { totalKeysExamined: number; totalDocsExamined: number; nReturned: number };
    };
    const indexes =
      JSON.stringify(plan.queryPlanner.winningPlan).match(/"indexName":"([^"]+)"/g) ?? [];
    const index = indexes.map((m) => m.slice(13, -1)).join(', ') || 'COLLSCAN';
    const s = plan.executionStats;
    rows.push(
      `| ${shape.name} | \`${index}\` | ${s.totalKeysExamined} | ${s.totalDocsExamined} | ${s.nReturned} |`,
    );
  }
  return rows;
}

await connectMongo(env.MONGO_URL);
try {
  const user = await UserModel.findOne({ email: PERF_EMAIL });
  if (!user) throw new Error('No perf user; run pnpm seed:perf first');
  const [siteCount, runCount, sample] = await Promise.all([
    SiteModel.countDocuments({ ownerId: user._id }),
    CheckRunModel.estimatedDocumentCount(),
    SiteModel.findOne({ ownerId: user._id }).sort({ currentScore: 1 }),
  ]);

  const cookie = await signIn();
  const cursors = await allCursors(cookie);
  let next = 0;
  const scenarios: Scenario[] = [
    { name: 'Sites, first page (25, by name)', path: () => '/sites' },
    { name: 'Sites, 100 per page, by score', path: () => '/sites?limit=100&sort=-score' },
    { name: 'Sites, by last checked', path: () => '/sites?sort=-lastCheckedAt' },
    { name: 'Sites, filtered by grade', path: () => '/sites?grade=F' },
    { name: 'Sites, filtered by status', path: () => '/sites?status=DOWN' },
    { name: 'Sites, filtered by tag', path: () => '/sites?tag=client-c' },
    {
      name: `Sites, deep pages (all ${cursors.length + 1} cursors)`,
      path: () =>
        `/sites?limit=100&sort=-score&cursor=${encodeURIComponent(cursors[next++ % cursors.length] ?? '')}`,
    },
    { name: 'Dashboard summary', path: () => '/sites/summary' },
    { name: 'Run history (one site)', path: () => `/sites/${sample?.id}/runs` },
    {
      name: '30-day score history (one site)',
      path: () => `/sites/${sample?.id}/score-history?days=30`,
    },
  ];

  const out: string[] = [
    `Dataset: ${siteCount.toLocaleString('en')} sites for one user, ${runCount.toLocaleString('en')} check runs. ${env.BENCH_REQUESTS} sequential requests per row after 5 warm-up requests.`,
    '',
    '| Request | p50 | p95 | max |',
    '| --- | ---: | ---: | ---: |',
  ];
  for (const scenario of scenarios) {
    const { p50, p95, max } = await time(cookie, scenario, env.BENCH_REQUESTS);
    out.push(
      `| ${scenario.name} | ${p50.toFixed(1)} ms | ${p95.toFixed(1)} ms | ${max.toFixed(1)} ms |`,
    );
  }
  out.push(
    '',
    '| Sites query | Index | Keys examined | Docs examined | Returned |',
    '| --- | --- | ---: | ---: | ---: |',
  );
  out.push(...(await explain(user._id)));
  process.stdout.write(`${out.join('\n')}\n`);
} finally {
  await disconnectMongo();
}

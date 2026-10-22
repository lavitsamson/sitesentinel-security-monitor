import { z } from 'zod';
import { connectMongo, disconnectMongo } from '@sitesentinel/db';
import { createPasswordHasher } from '../auth/passwords.js';
import { PERF_DEFAULTS, PERF_EMAIL, PERF_PASSWORD, seedPerfData } from './perf-data.js';

const env = z
  .object({
    MONGO_URL: z.string().regex(/^mongodb(\+srv)?:\/\//, 'must be a mongodb:// URL'),
    PERF_SITES: z.coerce.number().int().min(1).max(100_000).default(PERF_DEFAULTS.sites),
    PERF_RUNS_PER_SITE: z.coerce
      .number()
      .int()
      .min(1)
      .max(5_000)
      .default(PERF_DEFAULTS.runsPerSite),
  })
  .parse(process.env);

const total = env.PERF_SITES * env.PERF_RUNS_PER_SITE;
const started = Date.now();
await connectMongo(env.MONGO_URL);
try {
  const result = await seedPerfData(createPasswordHasher(), {
    sites: env.PERF_SITES,
    runsPerSite: env.PERF_RUNS_PER_SITE,
    onProgress: (inserted) => {
      if (inserted % 100_000 === 0 || inserted === total) {
        process.stdout.write(
          `  ${inserted.toLocaleString('en')} / ${total.toLocaleString('en')} runs\n`,
        );
      }
    },
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(0);
  process.stdout.write(
    `Seeded ${result.sites.toLocaleString('en')} sites and ${result.runs.toLocaleString('en')} runs in ${seconds} s. Sign in as ${PERF_EMAIL} / ${PERF_PASSWORD}\n`,
  );
} finally {
  await disconnectMongo();
}

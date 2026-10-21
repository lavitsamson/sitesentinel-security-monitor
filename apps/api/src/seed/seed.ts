import { z } from 'zod';
import { createPasswordHasher } from '../auth/passwords.js';
import { connectMongo, disconnectMongo } from '../infra/mongo.js';
import { DEMO_EMAIL, DEMO_PASSWORD, seedDemoData } from './demo-data.js';

// Only Mongo is needed, so validate just that rather than the full API config.
const { MONGO_URL } = z
  .object({ MONGO_URL: z.string().regex(/^mongodb(\+srv)?:\/\//, 'must be a mongodb:// URL') })
  .parse(process.env);

await connectMongo(MONGO_URL);
try {
  const result = await seedDemoData(createPasswordHasher());
  process.stdout.write(
    `Seeded ${result.sites} demo sites. Sign in as ${DEMO_EMAIL} / ${DEMO_PASSWORD}\n`,
  );
} finally {
  await disconnectMongo();
}

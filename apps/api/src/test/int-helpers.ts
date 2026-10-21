import type { Express } from 'express';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request, { type Response } from 'supertest';
import type { Clock } from '@sitesentinel/checks';
import { connectMongo, disconnectMongo, mongoose } from '@sitesentinel/db';
import { CSRF } from '../test-utils.js';

/**
 * One in-memory mongod per test file, with indexes built (unique constraints are
 * part of what's under test) and every collection emptied between tests.
 */
export function useTestMongo(): void {
  let mongod: MongoMemoryServer;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await connectMongo(mongod.getUri());
    await mongoose.connection.syncIndexes();
  });

  afterEach(async () => {
    await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
  });

  afterAll(async () => {
    await disconnectMongo();
    await mongod.stop();
  });
}

/** A clock tests can move forward. */
export function manualClock(start = '2026-10-21T09:00:00.000Z') {
  let current = new Date(start);
  const clock: Clock & { advance(ms: number): void } = {
    now: () => new Date(current),
    advance(ms) {
      current = new Date(current.getTime() + ms);
    },
  };
  return clock;
}

export const DEFAULT_PASSWORD = 'correct horse battery staple';

/** Registers a user and returns a cookie-carrying agent signed in as them. */
export async function signUp(app: Express, email = 'ada@example.com', name = 'Ada') {
  const agent = request.agent(app);
  const res = await agent
    .post('/api/v1/auth/register')
    .set(CSRF)
    .send({ email, name, password: DEFAULT_PASSWORD })
    .expect(201);
  return { agent, user: res.body as { id: string; email: string } };
}

/** The value of a cookie set by the response, or undefined. */
export function setCookie(res: Response, name: string): string | undefined {
  const header = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = header?.find((c) => c.startsWith(`${name}=`));
  return cookie?.slice(name.length + 1).split(';')[0];
}

/** The full Set-Cookie line for a cookie, to assert its attributes. */
export function setCookieLine(res: Response, name: string): string | undefined {
  const header = res.headers['set-cookie'] as unknown as string[] | undefined;
  return header?.find((c) => c.startsWith(`${name}=`));
}

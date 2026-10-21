import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { connectMongo, disconnectMongo } from '@sitesentinel/db';
import { pingMongo } from '../infra/mongo.js';
import { buildTestApp } from '../test-utils.js';

// Exercises the real Mongo probe against an in-memory mongod. Redis is stubbed
// here; it gets a real instance once the queue integration tests arrive.
describe('readiness against a real MongoDB', () => {
  let mongod: MongoMemoryServer;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await connectMongo(mongod.getUri());
  });

  afterAll(async () => {
    await disconnectMongo();
    await mongod.stop();
  });

  it('reports mongo up while connected', async () => {
    const app = buildTestApp({ readinessProbes: { mongo: pingMongo } });

    const res = await request(app).get('/api/v1/health/ready');

    expect(res.status).toBe(200);
    expect(res.body.checks.mongo.status).toBe('up');
  });

  it('reports mongo down after the connection closes', async () => {
    await disconnectMongo();
    const app = buildTestApp({ readinessProbes: { mongo: pingMongo } });

    const res = await request(app).get('/api/v1/health/ready');

    expect(res.status).toBe(503);
    expect(res.body.checks.mongo).toMatchObject({ status: 'down', error: 'not connected' });
  });
});

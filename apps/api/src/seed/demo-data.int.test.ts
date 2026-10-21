import request from 'supertest';
import { SiteModel } from '../models/site.model.js';
import { UserModel } from '../models/user.model.js';
import { useTestMongo } from '../test/int-helpers.js';
import { CSRF, buildTestApp, fastPasswords } from '../test-utils.js';
import { DEMO_EMAIL, DEMO_PASSWORD, DEMO_SITES, seedDemoData } from './demo-data.js';

useTestMongo();

describe('seedDemoData', () => {
  it('creates a demo login whose sites are labelled demo and pre-verified', async () => {
    await seedDemoData(fastPasswords);
    const agent = request.agent(buildTestApp());

    await agent
      .post('/api/v1/auth/login')
      .set(CSRF)
      .send({ email: DEMO_EMAIL, password: DEMO_PASSWORD })
      .expect(200);
    const res = await agent.get('/api/v1/sites?limit=100');

    expect(res.body.data).toHaveLength(DEMO_SITES.length);
    for (const site of res.body.data) {
      expect(site).toMatchObject({ demo: true, checkIntervalMinutes: 1440 });
      expect(site.verification.verifiedAt).not.toBeNull();
    }
  });

  it('is idempotent and leaves other users alone', async () => {
    await UserModel.create({ email: 'real@example.com', name: 'Real', passwordHash: 'x' });

    await seedDemoData(fastPasswords);
    await seedDemoData(fastPasswords);

    expect(await UserModel.countDocuments()).toBe(2);
    expect(await SiteModel.countDocuments()).toBe(DEMO_SITES.length);
  });
});

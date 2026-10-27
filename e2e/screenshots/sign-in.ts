import { request, type FullConfig } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The demo session, shared by every capture (login is rate-limited to 5 a minute). */
export const SESSION = join(tmpdir(), 'sitesentinel-screenshot-session.json');

export default async function signIn(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL;
  const context = await request.newContext({ baseURL });
  const res = await context.post('/api/v1/auth/login', {
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
    data: { email: 'demo@sitesentinel.demo', password: 'DemoPass123!' },
  });
  if (!res.ok()) {
    throw new Error(`Demo sign-in failed (${res.status()}): is the stack up and seeded?`);
  }
  await context.storageState({ path: SESSION });
  await context.dispose();
}

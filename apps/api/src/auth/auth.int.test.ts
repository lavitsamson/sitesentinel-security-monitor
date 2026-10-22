import request from 'supertest';
import { AuditLogModel, RefreshTokenModel, UserModel } from '@sitesentinel/db';
import { MemoryMailer } from '../mail/mailer.js';
import {
  DEFAULT_PASSWORD,
  manualClock,
  setCookie,
  setCookieLine,
  signUp,
  useTestMongo,
} from '../test/int-helpers.js';
import { CSRF, buildTestApp } from '../test-utils.js';

useTestMongo();

const login = (app: ReturnType<typeof buildTestApp>, email: string, password: string) =>
  request(app).post('/api/v1/auth/login').set(CSRF).send({ email, password });

describe('POST /auth/register', () => {
  it('creates the user, signs them in and never returns the hash', async () => {
    const app = buildTestApp();

    const res = await request(app)
      .post('/api/v1/auth/register')
      .set(CSRF)
      .send({ email: ' Ada@Example.com ', name: 'Ada', password: DEFAULT_PASSWORD });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.any(String),
      email: 'ada@example.com',
      name: 'Ada',
      emailVerifiedAt: null,
      notificationPrefs: { emailAlerts: true },
      createdAt: expect.any(String),
    });
    expect(JSON.stringify(res.body)).not.toMatch(/argon2|passwordHash/);
    const stored = await UserModel.findOne({ email: 'ada@example.com' });
    expect(stored?.passwordHash).toMatch(/^\$argon2id\$/);
  });

  it('sets httpOnly, SameSite=Strict cookies scoped to the API', async () => {
    const res = await request(buildTestApp())
      .post('/api/v1/auth/register')
      .set(CSRF)
      .send({ email: 'ada@example.com', name: 'Ada', password: DEFAULT_PASSWORD });

    expect(setCookieLine(res, 'ss_access')).toMatch(/Path=\/api;.*HttpOnly.*SameSite=Strict/);
    expect(setCookieLine(res, 'ss_refresh')).toMatch(
      /Path=\/api\/v1\/auth;.*HttpOnly.*SameSite=Strict/,
    );
  });

  it('rejects a duplicate email with 409', async () => {
    const app = buildTestApp();
    await signUp(app);

    const res = await request(app)
      .post('/api/v1/auth/register')
      .set(CSRF)
      .send({ email: 'ADA@example.com', name: 'Other', password: DEFAULT_PASSWORD });

    expect(res.status).toBe(409);
  });

  it('rejects a short password with field errors', async () => {
    const res = await request(buildTestApp())
      .post('/api/v1/auth/register')
      .set(CSRF)
      .send({ email: 'ada@example.com', name: 'Ada', password: 'too-short' });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([{ path: 'password', message: 'Use at least 12 characters' }]);
  });
});

describe('POST /auth/login', () => {
  it('signs in with the right password', async () => {
    const app = buildTestApp();
    await signUp(app);

    const res = await login(app, 'ADA@example.com', DEFAULT_PASSWORD);

    expect(res.status).toBe(200);
    expect(res.body.email).toBe('ada@example.com');
    expect(setCookie(res, 'ss_access')).toBeTruthy();
  });

  it('gives the same 401 for a wrong password and an unknown email', async () => {
    const app = buildTestApp();
    await signUp(app);

    const wrongPassword = await login(app, 'ada@example.com', 'not the password');
    const unknownEmail = await login(app, 'nobody@example.com', DEFAULT_PASSWORD);

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body.detail).toBe(unknownEmail.body.detail);
  });

  it('rate-limits after 5 attempts per IP and email', async () => {
    const app = buildTestApp();
    await signUp(app);
    for (let i = 0; i < 5; i++) await login(app, 'ada@example.com', 'wrong password!');

    const blocked = await login(app, 'ada@example.com', DEFAULT_PASSWORD);
    const otherAccount = await login(app, 'someone@example.com', 'whatever-password');

    expect(blocked.status).toBe(429);
    expect(blocked.headers['ratelimit-policy']).toBeDefined();
    expect(otherAccount.status).toBe(401);
  });
});

describe('GET /auth/me', () => {
  it('returns the signed-in user', async () => {
    const app = buildTestApp();
    const { agent, user } = await signUp(app);

    const res = await agent.get('/api/v1/auth/me');

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(user.id);
  });

  it('returns 401 without a session', async () => {
    const res = await request(buildTestApp()).get('/api/v1/auth/me');

    expect(res.status).toBe(401);
    expect(res.headers['content-type']).toMatch(/problem\+json/);
  });

  it('rejects a tampered or expired access token', async () => {
    const clock = manualClock();
    const app = buildTestApp({ clock });
    const { agent } = await signUp(app);

    const tampered = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', 'ss_access=abc.def.ghi');
    clock.advance(901_000);
    const expired = await agent.get('/api/v1/auth/me');

    expect(tampered.status).toBe(401);
    expect(expired.status).toBe(401);
  });
});

describe('POST /auth/refresh', () => {
  it('rotates the refresh token and issues a new access token', async () => {
    const app = buildTestApp();
    const reg = await request(app)
      .post('/api/v1/auth/register')
      .set(CSRF)
      .send({ email: 'ada@example.com', name: 'Ada', password: DEFAULT_PASSWORD });
    const first = setCookie(reg, 'ss_refresh')!;

    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .set(CSRF)
      .set('Cookie', `ss_refresh=${first}`);

    expect(res.status).toBe(204);
    const second = setCookie(res, 'ss_refresh');
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
    expect(setCookie(res, 'ss_access')).toBeTruthy();
  });

  it('detects reuse of a rotated token and revokes the whole family', async () => {
    const app = buildTestApp();
    const reg = await request(app)
      .post('/api/v1/auth/register')
      .set(CSRF)
      .send({ email: 'ada@example.com', name: 'Ada', password: DEFAULT_PASSWORD });
    const stolen = setCookie(reg, 'ss_refresh')!;
    const refresh = (token: string) =>
      request(app).post('/api/v1/auth/refresh').set(CSRF).set('Cookie', `ss_refresh=${token}`);

    const legit = await refresh(stolen);
    const current = setCookie(legit, 'ss_refresh')!;
    const replay = await refresh(stolen);
    const afterReplay = await refresh(current);

    expect(legit.status).toBe(204);
    expect(replay.status).toBe(401);
    expect(afterReplay.status).toBe(401);
    expect(await RefreshTokenModel.countDocuments({ revokedAt: null })).toBe(0);
  });

  it('lets only one of two concurrent refreshes with the same token win', async () => {
    const app = buildTestApp();
    const reg = await request(app)
      .post('/api/v1/auth/register')
      .set(CSRF)
      .send({ email: 'ada@example.com', name: 'Ada', password: DEFAULT_PASSWORD });
    const token = setCookie(reg, 'ss_refresh')!;

    const results = await Promise.all(
      [1, 2].map(() =>
        request(app).post('/api/v1/auth/refresh').set(CSRF).set('Cookie', `ss_refresh=${token}`),
      ),
    );

    expect(results.map((r) => r.status).sort()).toEqual([204, 401]);
  });

  it('rejects a missing, unknown or expired token and clears cookies', async () => {
    const clock = manualClock();
    const app = buildTestApp({ clock });
    const reg = await request(app)
      .post('/api/v1/auth/register')
      .set(CSRF)
      .send({ email: 'ada@example.com', name: 'Ada', password: DEFAULT_PASSWORD });
    const token = setCookie(reg, 'ss_refresh')!;

    const missing = await request(app).post('/api/v1/auth/refresh').set(CSRF);
    const unknown = await request(app)
      .post('/api/v1/auth/refresh')
      .set(CSRF)
      .set('Cookie', 'ss_refresh=made-up');
    clock.advance(31 * 24 * 60 * 60 * 1000);
    const expired = await request(app)
      .post('/api/v1/auth/refresh')
      .set(CSRF)
      .set('Cookie', `ss_refresh=${token}`);

    expect([missing.status, unknown.status, expired.status]).toEqual([401, 401, 401]);
    expect(setCookieLine(expired, 'ss_refresh')).toMatch(/Expires=Thu, 01 Jan 1970/);
  });
});

describe('POST /auth/logout', () => {
  it('revokes the session so the refresh token stops working', async () => {
    const app = buildTestApp();
    const reg = await request(app)
      .post('/api/v1/auth/register')
      .set(CSRF)
      .send({ email: 'ada@example.com', name: 'Ada', password: DEFAULT_PASSWORD });
    const token = setCookie(reg, 'ss_refresh')!;

    const out = await request(app)
      .post('/api/v1/auth/logout')
      .set(CSRF)
      .set('Cookie', `ss_refresh=${token}`);
    const refresh = await request(app)
      .post('/api/v1/auth/refresh')
      .set(CSRF)
      .set('Cookie', `ss_refresh=${token}`);

    expect(out.status).toBe(204);
    expect(refresh.status).toBe(401);
  });

  it('succeeds without a session', async () => {
    const res = await request(buildTestApp()).post('/api/v1/auth/logout').set(CSRF);

    expect(res.status).toBe(204);
  });
});

describe('password reset', () => {
  function resetTokenFrom(mailer: MemoryMailer): string {
    const match = /token=([^\s]+)/.exec(mailer.last()?.text ?? '');
    if (!match?.[1]) throw new Error('no reset link in email');
    return decodeURIComponent(match[1]);
  }

  it('emails a link, resets the password once, and ends every session', async () => {
    const mailer = new MemoryMailer();
    const app = buildTestApp({ mailer });
    const { agent } = await signUp(app);

    const forgot = await request(app)
      .post('/api/v1/auth/forgot-password')
      .set(CSRF)
      .send({ email: 'ada@example.com' });
    expect(forgot.status).toBe(202);
    expect(mailer.last()).toMatchObject({ to: 'ada@example.com' });
    expect(mailer.last()?.text).toContain('http://localhost:5173/reset-password?token=');
    const token = resetTokenFrom(mailer);

    const reset = await request(app)
      .post('/api/v1/auth/reset-password')
      .set(CSRF)
      .send({ token, password: 'a brand new passphrase' });
    const reuse = await request(app)
      .post('/api/v1/auth/reset-password')
      .set(CSRF)
      .send({ token, password: 'another new passphrase' });

    expect(reset.status).toBe(204);
    expect(reuse.status).toBe(400);
    expect((await login(app, 'ada@example.com', DEFAULT_PASSWORD)).status).toBe(401);
    expect((await login(app, 'ada@example.com', 'a brand new passphrase')).status).toBe(200);
    expect((await agent.post('/api/v1/auth/refresh').set(CSRF)).status).toBe(401);
    expect((await UserModel.findOne({ email: 'ada@example.com' }))?.emailVerifiedAt).not.toBeNull();
  });

  it('answers 202 for unknown emails without sending anything', async () => {
    const mailer = new MemoryMailer();
    const app = buildTestApp({ mailer });

    const res = await request(app)
      .post('/api/v1/auth/forgot-password')
      .set(CSRF)
      .send({ email: 'nobody@example.com' });

    expect(res.status).toBe(202);
    expect(mailer.sent).toHaveLength(0);
  });

  it('rejects an expired reset token', async () => {
    const mailer = new MemoryMailer();
    const clock = manualClock();
    const app = buildTestApp({ mailer, clock });
    await signUp(app);
    await request(app)
      .post('/api/v1/auth/forgot-password')
      .set(CSRF)
      .send({ email: 'ada@example.com' });

    clock.advance(61 * 60 * 1000);
    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .set(CSRF)
      .send({ token: resetTokenFrom(mailer), password: 'a brand new passphrase' });

    expect(res.status).toBe(400);
  });

  it('stores only a hash of the reset token', async () => {
    const mailer = new MemoryMailer();
    const app = buildTestApp({ mailer });
    await signUp(app);
    await request(app)
      .post('/api/v1/auth/forgot-password')
      .set(CSRF)
      .send({ email: 'ada@example.com' });

    const user = await UserModel.findOne({ email: 'ada@example.com' });

    expect(user?.passwordReset?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(user?.passwordReset?.tokenHash).not.toBe(resetTokenFrom(mailer));
  });
});

describe('PATCH /auth/me', () => {
  it('updates the name and email alert preference', async () => {
    const app = buildTestApp();
    const { agent } = await signUp(app);

    const res = await agent
      .patch('/api/v1/auth/me')
      .set(CSRF)
      .send({ name: ' Ada Lovelace ', notificationPrefs: { emailAlerts: false } });
    const me = await agent.get('/api/v1/auth/me');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: 'Ada Lovelace',
      notificationPrefs: { emailAlerts: false },
    });
    expect(me.body).toEqual(res.body);
    expect(await AuditLogModel.countDocuments({ action: 'user.update' })).toBe(1);
  });

  it('refuses to change the email, the password or nothing at all', async () => {
    const app = buildTestApp();
    const { agent } = await signUp(app);

    const email = await agent.patch('/api/v1/auth/me').set(CSRF).send({ email: 'x@example.com' });
    const password = await agent.patch('/api/v1/auth/me').set(CSRF).send({ passwordHash: 'x' });
    const empty = await agent.patch('/api/v1/auth/me').set(CSRF).send({});

    expect([email.status, password.status, empty.status]).toEqual([400, 400, 400]);
  });

  it('requires a session', async () => {
    const res = await request(buildTestApp())
      .patch('/api/v1/auth/me')
      .set(CSRF)
      .send({ name: 'Eve' });

    expect(res.status).toBe(401);
  });
});

describe('POST /auth/change-password', () => {
  const NEW_PASSWORD = 'an even longer passphrase';

  it('changes the password, ends other sessions and keeps this one signed in', async () => {
    const app = buildTestApp();
    const { agent } = await signUp(app);
    const otherDevice = await login(app, 'ada@example.com', DEFAULT_PASSWORD);
    const otherRefresh = setCookie(otherDevice, 'ss_refresh')!;

    const res = await agent
      .post('/api/v1/auth/change-password')
      .set(CSRF)
      .send({ currentPassword: DEFAULT_PASSWORD, newPassword: NEW_PASSWORD });
    const stale = await request(app)
      .post('/api/v1/auth/refresh')
      .set(CSRF)
      .set('Cookie', `ss_refresh=${otherRefresh}`);

    expect(res.status).toBe(204);
    expect(setCookie(res, 'ss_access')).toBeTruthy();
    expect((await agent.get('/api/v1/auth/me')).status).toBe(200);
    expect((await agent.post('/api/v1/auth/refresh').set(CSRF)).status).toBe(204);
    expect(stale.status).toBe(401);
    expect((await login(app, 'ada@example.com', DEFAULT_PASSWORD)).status).toBe(401);
    expect((await login(app, 'ada@example.com', NEW_PASSWORD)).status).toBe(200);
    expect(await AuditLogModel.countDocuments({ action: 'user.password.change' })).toBe(1);
  });

  it('rejects a wrong current password with 400 and keeps the old one', async () => {
    const app = buildTestApp();
    const { agent } = await signUp(app);

    const res = await agent
      .post('/api/v1/auth/change-password')
      .set(CSRF)
      .send({ currentPassword: 'not my password', newPassword: NEW_PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([{ path: 'currentPassword', message: 'Incorrect password' }]);
    expect((await login(app, 'ada@example.com', DEFAULT_PASSWORD)).status).toBe(200);
  });

  it('enforces the password policy on the new password', async () => {
    const app = buildTestApp();
    const { agent } = await signUp(app);

    const res = await agent
      .post('/api/v1/auth/change-password')
      .set(CSRF)
      .send({ currentPassword: DEFAULT_PASSWORD, newPassword: 'short' });

    expect(res.status).toBe(400);
    expect(res.body.errors[0].path).toBe('newPassword');
  });

  it('is rate-limited to 5 attempts a minute', async () => {
    const app = buildTestApp();
    const { agent } = await signUp(app);
    const attempt = () =>
      agent
        .post('/api/v1/auth/change-password')
        .set(CSRF)
        .send({ currentPassword: 'wrong password!', newPassword: NEW_PASSWORD });

    for (let i = 0; i < 5; i++) expect((await attempt()).status).toBe(400);

    expect((await attempt()).status).toBe(429);
  });
});

describe('CSRF protection', () => {
  it('rejects mutating requests without X-Requested-With', async () => {
    const res = await request(buildTestApp())
      .post('/api/v1/auth/login')
      .send({ email: 'ada@example.com', password: DEFAULT_PASSWORD });

    expect(res.status).toBe(403);
    expect(res.body.detail).toMatch(/x-requested-with/i);
  });
});

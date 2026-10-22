import { loadConfig } from './config.js';

const ALERT_KEY = Buffer.alloc(32, 7);

const validEnv = {
  MONGO_URL: 'mongodb://localhost:27017/sitesentinel',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
  ALERT_SECRET_KEY: ALERT_KEY.toString('base64'),
};

describe('loadConfig', () => {
  it('applies defaults for optional settings', () => {
    expect(loadConfig(validEnv)).toEqual({
      env: 'development',
      port: 4000,
      logLevel: 'info',
      mongoUrl: validEnv.MONGO_URL,
      redisUrl: validEnv.REDIS_URL,
      webOrigin: 'http://localhost:5173',
      bodyLimit: '100kb',
      readinessTimeoutMs: 2000,
      trustProxy: 0,
      auth: {
        jwtSecret: validEnv.JWT_ACCESS_SECRET,
        accessTokenTtlSeconds: 900,
        refreshTokenTtlDays: 30,
        passwordResetTtlMinutes: 60,
        cookieSecure: false,
      },
      smtpUrl: 'smtp://localhost:1025',
      mailFrom: 'SiteSentinel <no-reply@sitesentinel.local>',
      alertSecretKey: ALERT_KEY,
      metricsToken: null,
      queueBoard: null,
    });
  });

  it('mounts Bull Board outside production once a password is set', () => {
    const password = 'p'.repeat(16);
    expect(loadConfig({ ...validEnv, BULL_BOARD_PASSWORD: password }).queueBoard).toEqual({
      username: 'admin',
      password,
    });
    expect(
      loadConfig({ ...validEnv, NODE_ENV: 'production', BULL_BOARD_PASSWORD: password }).queueBoard,
    ).toBeNull();
    expect(
      loadConfig({
        ...validEnv,
        NODE_ENV: 'production',
        BULL_BOARD_ENABLED: 'true',
        BULL_BOARD_USERNAME: 'ops',
        BULL_BOARD_PASSWORD: password,
      }).queueBoard,
    ).toEqual({ username: 'ops', password });
    expect(
      loadConfig({ ...validEnv, BULL_BOARD_ENABLED: 'false', BULL_BOARD_PASSWORD: password })
        .queueBoard,
    ).toBeNull();
  });

  it('refuses to enable Bull Board without a strong password', () => {
    expect(() => loadConfig({ ...validEnv, BULL_BOARD_ENABLED: 'true' })).toThrow(
      /BULL_BOARD_PASSWORD: is required/,
    );
    expect(() => loadConfig({ ...validEnv, BULL_BOARD_PASSWORD: 'short' })).toThrow(
      /BULL_BOARD_PASSWORD: must be at least 16/,
    );
  });

  it('reads an optional metrics token', () => {
    expect(loadConfig({ ...validEnv, METRICS_TOKEN: 't'.repeat(16) }).metricsToken).toBe(
      't'.repeat(16),
    );
    expect(() => loadConfig({ ...validEnv, METRICS_TOKEN: 'short' })).toThrow(/METRICS_TOKEN/);
  });

  it('coerces numeric settings from strings', () => {
    expect(loadConfig({ ...validEnv, API_PORT: '8080' }).port).toBe(8080);
  });

  it('defaults to Secure cookies in production, overridable either way', () => {
    expect(loadConfig({ ...validEnv, NODE_ENV: 'production' }).auth.cookieSecure).toBe(true);
    expect(
      loadConfig({ ...validEnv, NODE_ENV: 'production', COOKIE_SECURE: 'false' }).auth.cookieSecure,
    ).toBe(false);
    expect(loadConfig({ ...validEnv, COOKIE_SECURE: 'true' }).auth.cookieSecure).toBe(true);
  });

  it('requires a long JWT secret', () => {
    expect(() => loadConfig({ ...validEnv, JWT_ACCESS_SECRET: 'short' })).toThrow(
      /JWT_ACCESS_SECRET: must be at least 32 characters/,
    );
  });

  it.each(['', 'c2hvcnQ='])('rejects ALERT_SECRET_KEY=%j', (value) => {
    expect(() => loadConfig({ ...validEnv, ALERT_SECRET_KEY: value })).toThrow(
      /ALERT_SECRET_KEY: must be base64 of exactly 32 bytes/,
    );
  });

  it('lists every invalid setting at once', () => {
    expect(() => loadConfig({ MONGO_URL: 'postgres://nope', API_PORT: 'abc' })).toThrow(
      /MONGO_URL[\s\S]*REDIS_URL|REDIS_URL[\s\S]*MONGO_URL/,
    );
  });
});

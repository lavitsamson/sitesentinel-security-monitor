import { loadConfig } from './config.js';

const ALERT_KEY = Buffer.alloc(32, 7);

const validEnv = {
  MONGO_URL: 'mongodb://localhost:27017/sitesentinel',
  REDIS_URL: 'redis://localhost:6379',
  ALERT_SECRET_KEY: ALERT_KEY.toString('base64'),
};

describe('loadConfig', () => {
  it('applies defaults for optional settings', () => {
    expect(loadConfig(validEnv)).toEqual({
      env: 'development',
      logLevel: 'info',
      mongoUrl: validEnv.MONGO_URL,
      redisUrl: validEnv.REDIS_URL,
      concurrency: 5,
      shutdownTimeoutMs: 30_000,
      webOrigin: 'http://localhost:5173',
      smtpUrl: 'smtp://localhost:1025',
      mailFrom: 'SiteSentinel <no-reply@sitesentinel.local>',
      alertSecretKey: ALERT_KEY,
    });
  });

  it('reads worker concurrency from the environment', () => {
    expect(loadConfig({ ...validEnv, WORKER_CONCURRENCY: '12' }).concurrency).toBe(12);
  });

  it.each(['0', '101', 'many'])('rejects WORKER_CONCURRENCY=%s', (value) => {
    expect(() => loadConfig({ ...validEnv, WORKER_CONCURRENCY: value })).toThrow(
      /WORKER_CONCURRENCY/,
    );
  });

  it.each(['', 'c2hvcnQ='])('rejects ALERT_SECRET_KEY=%j', (value) => {
    expect(() => loadConfig({ ...validEnv, ALERT_SECRET_KEY: value })).toThrow(
      /ALERT_SECRET_KEY: must be base64 of exactly 32 bytes/,
    );
  });

  it('requires connection URLs', () => {
    expect(() => loadConfig({})).toThrow(/MONGO_URL[\s\S]*REDIS_URL/);
  });
});

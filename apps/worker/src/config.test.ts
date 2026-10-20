import { loadConfig } from './config.js';

const validEnv = {
  MONGO_URL: 'mongodb://localhost:27017/sitesentinel',
  REDIS_URL: 'redis://localhost:6379',
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

  it('requires connection URLs', () => {
    expect(() => loadConfig({})).toThrow(/MONGO_URL[\s\S]*REDIS_URL/);
  });
});

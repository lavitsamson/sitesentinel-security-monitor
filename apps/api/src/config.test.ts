import { loadConfig } from './config.js';

const validEnv = {
  MONGO_URL: 'mongodb://localhost:27017/sitesentinel',
  REDIS_URL: 'redis://localhost:6379',
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
    });
  });

  it('coerces numeric settings from strings', () => {
    expect(loadConfig({ ...validEnv, API_PORT: '8080' }).port).toBe(8080);
  });

  it('lists every invalid setting at once', () => {
    expect(() => loadConfig({ MONGO_URL: 'postgres://nope', API_PORT: 'abc' })).toThrow(
      /MONGO_URL[\s\S]*REDIS_URL|REDIS_URL[\s\S]*MONGO_URL/,
    );
  });
});

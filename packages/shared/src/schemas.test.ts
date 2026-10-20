import {
  CHECK_TYPES,
  checkIntervalSchema,
  checkTypeSchema,
  healthReadySchema,
  problemDetailsSchema,
} from './index.js';

describe('enums', () => {
  it('lists exactly the six passive check types', () => {
    expect(CHECK_TYPES).toHaveLength(6);
    expect(checkTypeSchema.safeParse('TLS').success).toBe(true);
    expect(checkTypeSchema.safeParse('PORT_SCAN').success).toBe(false);
  });

  it.each([5, 15, 60, 1440])('accepts a %i minute check interval', (minutes) => {
    expect(checkIntervalSchema.parse(minutes)).toBe(minutes);
  });

  it.each([0, 1, 30, 10_000])('rejects a %i minute check interval', (minutes) => {
    expect(checkIntervalSchema.safeParse(minutes).success).toBe(false);
  });
});

describe('problemDetailsSchema', () => {
  it('accepts a minimal RFC 9457 body', () => {
    const body = { type: 'about:blank', title: 'Not Found', status: 404 };
    expect(problemDetailsSchema.parse(body)).toEqual(body);
  });

  it('rejects non-error status codes', () => {
    expect(problemDetailsSchema.safeParse({ type: 'x', title: 'OK', status: 200 }).success).toBe(
      false,
    );
  });
});

describe('healthReadySchema', () => {
  it('accepts a per-dependency report', () => {
    const report = {
      status: 'error',
      checks: {
        mongo: { status: 'up', latencyMs: 3 },
        redis: { status: 'down', latencyMs: 1000, error: 'timeout' },
      },
    };
    expect(healthReadySchema.parse(report)).toEqual(report);
  });
});

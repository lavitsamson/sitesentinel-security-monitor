import { registerSchema } from '@sitesentinel/shared';
import { describe, expect, it } from 'vitest';
import { toTypedSchema } from './zod-schema';

describe('toTypedSchema', () => {
  const schema = toTypedSchema(registerSchema);

  it('returns the parsed (transformed) value when valid', async () => {
    await expect(
      schema.parse({ name: ' Ada ', email: 'ADA@example.com', password: 'long enough pass' }),
    ).resolves.toEqual({
      value: { name: 'Ada', email: 'ada@example.com', password: 'long enough pass' },
      errors: [],
    });
  });

  it('groups issue messages by field path', async () => {
    const { value, errors } = await schema.parse({ name: '', email: 'nope', password: 'short' });

    expect(value).toBeUndefined();
    expect(errors).toEqual(
      expect.arrayContaining([
        { path: 'name', errors: ['Enter your name'] },
        { path: 'password', errors: ['Use at least 12 characters'] },
        expect.objectContaining({ path: 'email' }),
      ]),
    );
  });
});

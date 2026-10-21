import {
  createSiteSchema,
  listSitesQuerySchema,
  loginSchema,
  paginatedSchema,
  publicUserSchema,
  registerSchema,
  siteSchema,
  updateSiteSchema,
} from './index.js';

describe('registerSchema', () => {
  const valid = { email: ' Ada@Example.COM ', password: 'correct horse battery', name: ' Ada ' };

  it('normalises email and name', () => {
    expect(registerSchema.parse(valid)).toEqual({
      email: 'ada@example.com',
      password: 'correct horse battery',
      name: 'Ada',
    });
  });

  it.each([
    ['short password', { password: 'elevenchars' }],
    ['huge password', { password: 'x'.repeat(129) }],
    ['bad email', { email: 'not-an-email' }],
    ['empty name', { name: '  ' }],
  ])('rejects a %s', (_label, patch) => {
    expect(registerSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });
});

describe('loginSchema', () => {
  it('does not apply strength rules to login', () => {
    expect(loginSchema.safeParse({ email: 'a@b.co', password: 'short' }).success).toBe(true);
  });
});

describe('publicUserSchema', () => {
  it('strips anything that is not part of the public shape', () => {
    const parsed = publicUserSchema.parse({
      id: '1',
      email: 'a@b.co',
      name: 'A',
      emailVerifiedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      passwordHash: '$argon2id$...',
    });
    expect(parsed).not.toHaveProperty('passwordHash');
  });
});

describe('createSiteSchema', () => {
  it('applies defaults and normalises domain and tags', () => {
    expect(
      createSiteSchema.parse({ domain: 'https://Example.com', tags: ['Prod', 'prod', ' web '] }),
    ).toEqual({ domain: 'example.com', checkIntervalMinutes: 60, tags: ['prod', 'web'] });
  });

  it('rejects an unsupported interval and too many tags', () => {
    expect(createSiteSchema.safeParse({ domain: 'a.com', checkIntervalMinutes: 30 }).success).toBe(
      false,
    );
    const tags = Array.from({ length: 21 }, (_, i) => `t${i}`);
    expect(createSiteSchema.safeParse({ domain: 'a.com', tags }).success).toBe(false);
  });
});

describe('updateSiteSchema', () => {
  it('accepts a partial patch', () => {
    expect(updateSiteSchema.parse({ paused: true })).toEqual({ paused: true });
  });

  it('rejects an empty patch', () => {
    expect(updateSiteSchema.safeParse({}).success).toBe(false);
  });

  it('rejects changing the domain', () => {
    expect(updateSiteSchema.safeParse({ domain: 'other.com' }).success).toBe(false);
  });
});

describe('listSitesQuerySchema', () => {
  it('coerces query-string values and applies defaults', () => {
    expect(listSitesQuerySchema.parse({ limit: '5' })).toEqual({ limit: 5, sort: 'name' });
  });

  it('caps the page size at 100', () => {
    expect(listSitesQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
  });

  it('rejects unknown sorts', () => {
    expect(listSitesQuerySchema.safeParse({ sort: 'ownerId' }).success).toBe(false);
  });
});

describe('paginatedSchema', () => {
  it('wraps items in the list envelope', () => {
    const schema = paginatedSchema(siteSchema.pick({ id: true }));
    const body = { data: [{ id: 'a' }], pageInfo: { nextCursor: null, hasNextPage: false } };
    expect(schema.parse(body)).toEqual(body);
  });
});

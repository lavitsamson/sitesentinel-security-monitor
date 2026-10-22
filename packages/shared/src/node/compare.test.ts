import { bearerTokenMatches, constantTimeEqual } from './compare.js';

describe('constantTimeEqual', () => {
  it('matches equal strings only', () => {
    expect(constantTimeEqual('s3cret-token', 's3cret-token')).toBe(true);
    expect(constantTimeEqual('s3cret-token', 's3cret-tokeN')).toBe(false);
  });

  it('handles different lengths without throwing', () => {
    expect(constantTimeEqual('short', 'a much longer secret')).toBe(false);
    expect(constantTimeEqual('', 'secret')).toBe(false);
  });
});

describe('bearerTokenMatches', () => {
  it('accepts the exact bearer token', () => {
    expect(bearerTokenMatches('Bearer abc123', 'abc123')).toBe(true);
  });

  it.each([
    undefined,
    '',
    'abc123',
    'Bearer',
    'Bearer ',
    'Basic abc123',
    'Bearer abc1234',
    'Bearer abc123 x',
  ])('rejects %j', (header) => {
    expect(bearerTokenMatches(header, 'abc123')).toBe(false);
  });
});

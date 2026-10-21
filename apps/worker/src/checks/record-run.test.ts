import { MAX_RAW_BYTES, capRaw } from './record-run.js';

describe('capRaw', () => {
  it('keeps evidence under the cap as-is', () => {
    const raw = { headers: { server: 'nginx' } };
    expect(capRaw(raw)).toBe(raw);
  });

  it('replaces oversized evidence with a marker', () => {
    const raw = { body: 'x'.repeat(MAX_RAW_BYTES) };
    expect(capRaw(raw)).toEqual({ truncated: true, bytes: MAX_RAW_BYTES + 11 });
  });
});

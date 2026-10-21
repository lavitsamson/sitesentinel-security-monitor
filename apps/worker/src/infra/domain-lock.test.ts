import { createMemoryDomainLock } from './domain-lock.js';

describe('createMemoryDomainLock', () => {
  it('allows one holder per domain until released', async () => {
    const lock = createMemoryDomainLock();

    const first = await lock.acquire('example.com', 'job-1');
    expect(first).not.toBeNull();
    expect(await lock.acquire('example.com', 'job-2')).toBeNull();
    expect(await lock.acquire('other.example', 'job-3')).not.toBeNull();

    await first!.release();
    expect(await lock.acquire('example.com', 'job-2')).not.toBeNull();
  });
});

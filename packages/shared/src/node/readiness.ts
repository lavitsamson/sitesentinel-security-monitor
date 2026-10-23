import type { DependencyHealth, HealthReady } from '../health.js';

/** Resolves if the dependency is usable, rejects otherwise. */
export type DependencyProbe = () => Promise<unknown>;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function probe(fn: DependencyProbe, timeoutMs: number): Promise<DependencyHealth> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  try {
    await withTimeout(Promise.resolve().then(fn), timeoutMs);
    return { status: 'up', latencyMs: elapsed() };
  } catch (err) {
    return {
      status: 'down',
      latencyMs: elapsed(),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Probes every dependency in parallel; the service is ready only if all are up. */
export async function checkReadiness(
  probes: Record<string, DependencyProbe>,
  timeoutMs: number,
): Promise<HealthReady> {
  const entries = await Promise.all(
    Object.entries(probes).map(async ([name, fn]) => [name, await probe(fn, timeoutMs)] as const),
  );
  const allUp = entries.every(([, result]) => result.status === 'up');
  return { status: allUp ? 'ok' : 'error', checks: Object.fromEntries(entries) };
}

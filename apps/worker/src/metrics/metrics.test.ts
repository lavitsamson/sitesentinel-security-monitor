import { DelayedError } from 'bullmq';
import { createWorkerMetrics, outcomeOf } from './metrics.js';

const firstOfThree = { attemptsMade: 0, attempts: 3 };
const lastOfThree = { attemptsMade: 2, attempts: 3 };

describe('outcomeOf', () => {
  it('tells a retry from a final failure', () => {
    expect(outcomeOf(new Error('boom'), firstOfThree)).toBe('retry');
    expect(outcomeOf(new Error('boom'), { attemptsMade: 1, attempts: 3 })).toBe('retry');
    expect(outcomeOf(new Error('boom'), lastOfThree)).toBe('failed');
    expect(outcomeOf(new Error('boom'), { attemptsMade: 0, attempts: 1 })).toBe('failed');
  });

  it('does not count a parked job as a failure', () => {
    expect(outcomeOf(new DelayedError(), lastOfThree)).toBe('delayed');
  });
});

describe('createWorkerMetrics', () => {
  it('records each attempt by queue and outcome, and passes results and errors through', async () => {
    const metrics = createWorkerMetrics();

    await expect(metrics.observeJob('checks', firstOfThree, async () => 'ok')).resolves.toBe('ok');
    await expect(
      metrics.observeJob('checks', firstOfThree, () => Promise.reject(new Error('flaky'))),
    ).rejects.toThrow('flaky');
    await expect(
      metrics.observeJob('alerts', lastOfThree, () => Promise.reject(new Error('down'))),
    ).rejects.toThrow('down');
    await expect(
      metrics.observeJob('checks', firstOfThree, () => Promise.reject(new DelayedError())),
    ).rejects.toBeInstanceOf(DelayedError);

    const text = await metrics.registry.metrics();
    expect(text).toContain(
      'sitesentinel_jobs_processed_total{queue="checks",outcome="completed"} 1',
    );
    expect(text).toContain('sitesentinel_jobs_processed_total{queue="checks",outcome="retry"} 1');
    expect(text).toContain('sitesentinel_jobs_processed_total{queue="checks",outcome="delayed"} 1');
    expect(text).toContain('sitesentinel_jobs_processed_total{queue="alerts",outcome="failed"} 1');
    expect(text).toContain(
      'sitesentinel_job_duration_seconds_count{queue="checks",outcome="completed"} 1',
    );
  });

  it('counts check runs by type and result', async () => {
    const metrics = createWorkerMetrics();
    metrics.recordCheckRun('TLS', 'PASS');
    metrics.recordCheckRun('TLS', 'PASS');
    metrics.recordCheckRun('UPTIME', 'ERROR');

    const text = await metrics.registry.metrics();
    expect(text).toContain('sitesentinel_check_runs_total{type="TLS",status="PASS"} 2');
    expect(text).toContain('sitesentinel_check_runs_total{type="UPTIME",status="ERROR"} 1');
  });

  it('keeps registries separate, so many can exist in one process', async () => {
    const a = createWorkerMetrics();
    const b = createWorkerMetrics();
    a.recordCheckRun('TLS', 'FAIL');

    expect(await b.registry.metrics()).not.toContain('status="FAIL"');
  });
});

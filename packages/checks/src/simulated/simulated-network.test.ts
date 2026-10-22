import { describe, expect, it } from '@jest/globals';
import { CHECK_TYPES, gradeFor, overallScore, type CheckType } from '@sitesentinel/shared';
import { runCheck } from '../checks/index.js';
import { fixedClock } from '../clock.js';
import { NOW } from '../test/fakes.js';
import type { CheckDeps } from '../types.js';
import { verifyOwnership } from '../verification.js';
import {
  createSimulatedNetwork,
  simulatedDomainKey,
  type SimulatedDomainState,
} from './simulated-network.js';

const domain = 'shop.example';

function networkWith(states: Record<string, SimulatedDomainState> = {}) {
  const store = {
    get: async (key: string) => {
      const entry = Object.entries(states).find(([d]) => simulatedDomainKey(d) === key);
      return entry ? JSON.stringify(entry[1]) : null;
    },
  };
  const clock = fixedClock(NOW);
  const deps: CheckDeps = { ...createSimulatedNetwork({ store, clock }), clock };
  return deps;
}

async function runAll(deps: CheckDeps) {
  const results = new Map<CheckType, Awaited<ReturnType<typeof runCheck>>>();
  for (const type of CHECK_TYPES) results.set(type, await runCheck(type, { domain }, deps));
  return results;
}

describe('createSimulatedNetwork', () => {
  it('serves a well-run site that passes every check with an A', async () => {
    const results = await runAll(networkWith());

    for (const [type, result] of results) {
      expect({ type, status: result.status }).toEqual({ type, status: 'PASS' });
    }
    const score = overallScore([...results].map(([type, r]) => ({ type, ...r })));
    expect(score).not.toBeNull();
    expect(gradeFor(score ?? 0)).toBe('A');
  });

  it('keeps response times stable per domain and answers HEAD without a body', async () => {
    const { http } = networkWith();
    const head = await http.request({ url: `https://${domain}/`, method: 'HEAD', maxRedirects: 3 });
    const again = await http.request({ url: `https://${domain}/`, method: 'GET', maxRedirects: 3 });

    expect(head.body).toBe('');
    expect(head.durationMs).toBe(again.durationMs);
    expect(head.durationMs).toBeGreaterThanOrEqual(80);
    expect(head.durationMs).toBeLessThan(240);
  });

  it('answers unknown paths with 404 and accepts webhook POSTs', async () => {
    const { http } = networkWith();
    const missing = await http.request({
      url: `https://${domain}/nope`,
      method: 'GET',
      maxRedirects: 0,
    });
    const webhook = await http.request({
      url: 'https://hooks.example/alerts',
      method: 'POST',
      maxRedirects: 0,
      body: '{}',
    });

    expect(missing.status).toBe(404);
    expect(webhook.status).toBe(200);
  });

  it('has no MX for underscore names', async () => {
    const { dns } = networkWith();
    await expect(dns.resolveMx(`_dmarc.${domain}`)).rejects.toMatchObject({ code: 'ENODATA' });
  });

  describe('ownership verification', () => {
    const token = 'tok_123';

    it('fails until the owner publishes the token', async () => {
      const result = await verifyOwnership({ domain, token }, networkWith());
      expect(result.verified).toBe(false);
      expect(result.attempts.map((a) => a.method)).toEqual(['DNS_TXT', 'WELL_KNOWN_FILE']);
    });

    it('accepts a published TXT record', async () => {
      const deps = networkWith({ [domain]: { txt: [`sitesentinel-verify=${token}`] } });
      await expect(verifyOwnership({ domain, token }, deps)).resolves.toMatchObject({
        verified: true,
        method: 'DNS_TXT',
      });
    });

    it('accepts a published verification file', async () => {
      const deps = networkWith({ [domain]: { verificationFile: `${token}\n` } });
      await expect(
        verifyOwnership({ domain, token, method: 'WELL_KNOWN_FILE' }, deps),
      ).resolves.toMatchObject({ verified: true, method: 'WELL_KNOWN_FILE' });
    });
  });

  describe('faults', () => {
    it('CERT_EXPIRED fails the TLS check', async () => {
      const deps = networkWith({ [domain]: { fault: 'CERT_EXPIRED' } });
      const result = await runCheck('TLS', { domain }, deps);

      expect(result.status).toBe('FAIL');
      expect(result.findings.map((f) => f.code)).toEqual(['TLS_CERT_EXPIRED']);
    });

    it('DOWN makes the site unreachable', async () => {
      const deps = networkWith({ [domain]: { fault: 'DOWN' } });
      const uptime = await runCheck('UPTIME', { domain }, deps);
      const redirect = await runCheck('HTTPS_REDIRECT', { domain }, deps);

      expect(uptime.status).toBe('FAIL');
      expect(uptime.raw).toMatchObject({ up: false, error: 'NETWORK' });
      expect(redirect.findings.map((f) => f.code)).toEqual(['HTTPS_REDIRECT_PORT_CLOSED']);
    });

    it('PLAIN_HTTP serves the site without a redirect', async () => {
      const deps = networkWith({ [domain]: { fault: 'PLAIN_HTTP' } });
      const result = await runCheck('HTTPS_REDIRECT', { domain }, deps);

      expect(result.status).toBe('FAIL');
      expect(result.findings.map((f) => f.code)).toEqual(['HTTPS_REDIRECT_MISSING']);
    });

    it('only affects the domain it was set on', async () => {
      const deps = networkWith({ 'other.example': { fault: 'CERT_EXPIRED' } });
      await expect(runCheck('TLS', { domain }, deps)).resolves.toMatchObject({ status: 'PASS' });
    });
  });
});

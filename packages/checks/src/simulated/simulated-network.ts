import { VERIFICATION_FILE_PATH } from '@sitesentinel/shared';
import { DAY_MS } from '../checks/result.js';
import { SECURITY_TXT_PATH } from '../checks/security-txt.js';
import { SafeFetchError } from '../net/safe-fetch.js';
import type {
  CheckDeps,
  Clock,
  DnsResolver,
  HttpClient,
  HttpResponse,
  TlsConnector,
} from '../types.js';

/**
 * A stand-in for the internet, used by the E2E suite and local demos so that no
 * real domain is ever contacted (CLAUDE.md §2). Every domain is a well-run site
 * that scores an A; a test changes one domain's behaviour by writing its state
 * to the shared store (Redis in the apps), acting as the domain's owner would:
 * publishing a verification record, or breaking something on purpose.
 *
 * It is wired in only when `SIMULATED_NETWORK=true`, which both apps refuse in
 * production.
 */

/** Something wrong with the simulated site, set by a test to force a failure. */
export const SIMULATED_FAULTS = ['CERT_EXPIRED', 'DOWN', 'PLAIN_HTTP'] as const;
export type SimulatedFault = (typeof SIMULATED_FAULTS)[number];

/** Per-domain overrides, stored as JSON under `simulatedDomainKey(domain)`. */
export interface SimulatedDomainState {
  /** Extra TXT records on the apex, e.g. `sitesentinel-verify=<token>`. */
  txt?: string[];
  /** Body served at /.well-known/sitesentinel-verify.txt. */
  verificationFile?: string;
  fault?: SimulatedFault;
}

/** Read access to the shared state; an ioredis client satisfies it. */
export interface SimulatedStateStore {
  get(key: string): Promise<string | null>;
}

export const SIMULATED_KEY_PREFIX = 'simulated-network:';

export function simulatedDomainKey(domain: string): string {
  return `${SIMULATED_KEY_PREFIX}${domain.toLowerCase()}`;
}

export type SimulatedNetwork = Pick<CheckDeps, 'http' | 'dns' | 'tls'>;

const GOOD_HEADERS: Record<string, string> = {
  'content-type': 'text/html; charset=utf-8',
  'strict-transport-security': 'max-age=31536000; includeSubDomains; preload',
  'content-security-policy': "default-src 'self'; frame-ancestors 'none'; object-src 'none'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

/** A stable 80–239 ms response time per domain, so charts look plausible but tests stay deterministic. */
function responseTimeMs(domain: string): number {
  let hash = 0;
  for (const char of domain) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return 80 + (hash % 160);
}

function dnsNoData(hostname: string): Error {
  return Object.assign(new Error(`queryTxt ENODATA ${hostname}`), { code: 'ENODATA' });
}

export function createSimulatedNetwork({
  store,
  clock,
}: {
  store: SimulatedStateStore;
  clock: Clock;
}): SimulatedNetwork {
  async function stateOf(domain: string): Promise<SimulatedDomainState> {
    const raw = await store.get(simulatedDomainKey(domain));
    return raw ? (JSON.parse(raw) as SimulatedDomainState) : {};
  }

  const http: HttpClient = {
    async request(req) {
      const url = new URL(req.url);
      const domain = url.hostname;
      const state = await stateOf(domain);
      const reply = (status: number, headers: Record<string, string>, body = ''): HttpResponse => ({
        status,
        headers,
        body: req.method === 'HEAD' ? '' : body,
        url: req.url,
        durationMs: responseTimeMs(domain),
      });

      // Webhook alerts: any endpoint accepts them.
      if (req.method === 'POST') return reply(200, {}, 'ok');

      if (state.fault === 'DOWN') {
        throw new SafeFetchError('NETWORK', `connect ECONNREFUSED (simulated outage of ${domain})`);
      }

      if (url.protocol === 'http:') {
        if (state.fault === 'PLAIN_HTTP')
          return reply(200, { 'content-type': 'text/html' }, '<h1>Hi</h1>');
        return reply(301, { location: `https://${domain}${url.pathname}` });
      }

      if (url.pathname === SECURITY_TXT_PATH) {
        const expires = new Date(clock.now().getTime() + 180 * DAY_MS).toISOString();
        return reply(
          200,
          { 'content-type': 'text/plain; charset=utf-8' },
          `Contact: mailto:security@${domain}\nExpires: ${expires}\n`,
        );
      }
      if (url.pathname === VERIFICATION_FILE_PATH) {
        return state.verificationFile === undefined
          ? reply(404, { 'content-type': 'text/plain' }, 'Not found')
          : reply(200, { 'content-type': 'text/plain' }, state.verificationFile);
      }
      if (url.pathname === '/') {
        return reply(200, GOOD_HEADERS, `<!doctype html><title>${domain}</title>`);
      }
      return reply(404, { 'content-type': 'text/plain' }, 'Not found');
    },
  };

  const dns: DnsResolver = {
    async resolveTxt(hostname) {
      if (hostname.startsWith('_dmarc.')) {
        const domain = hostname.slice('_dmarc.'.length);
        return [[`v=DMARC1; p=reject; rua=mailto:dmarc@${domain}`]];
      }
      const state = await stateOf(hostname);
      return [['v=spf1 mx -all'], ...(state.txt ?? []).map((record) => [record])];
    },
    async resolveMx(hostname) {
      if (hostname.startsWith('_')) throw dnsNoData(hostname);
      return [{ exchange: `mx.${hostname}`, priority: 10 }];
    },
  };

  const tls: TlsConnector = {
    async handshake(hostname) {
      const state = await stateOf(hostname);
      const now = clock.now().getTime();
      const expired = state.fault === 'CERT_EXPIRED';
      return {
        protocol: 'TLSv1.3',
        authorized: !expired,
        authorizationError: expired ? 'CERT_HAS_EXPIRED' : null,
        chain: [
          {
            subject: `CN=${hostname}`,
            issuer: 'CN=Simulated CA',
            subjectAltNames: [hostname, `*.${hostname}`],
            validFrom: new Date(now - (expired ? 92 : 30) * DAY_MS),
            validTo: new Date(now + (expired ? -2 : 60) * DAY_MS),
          },
          {
            subject: 'CN=Simulated CA',
            issuer: 'CN=Simulated CA',
            subjectAltNames: [],
            validFrom: new Date(now - 365 * DAY_MS),
            validTo: new Date(now + 3650 * DAY_MS),
          },
        ],
      };
    },
  };

  return { http, dns, tls };
}

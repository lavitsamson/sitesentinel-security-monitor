import { fixedClock } from '../clock.js';
import type {
  CheckDeps,
  DnsResolver,
  HttpClient,
  HttpRequest,
  HttpResponse,
  TlsConnector,
} from '../types.js';

export const NOW = '2026-06-01T12:00:00.000Z';

type Reply = Partial<HttpResponse> | Error;

/**
 * An in-memory HttpClient: replies are keyed by `METHOD url`. Unknown requests
 * throw, so a check can't silently depend on a request the test didn't expect.
 */
export function fakeHttp(replies: Record<string, Reply>): HttpClient & { calls: HttpRequest[] } {
  const calls: HttpRequest[] = [];
  return {
    calls,
    async request(req) {
      calls.push(req);
      const reply = replies[`${req.method} ${req.url}`];
      if (reply === undefined) throw new Error(`Unexpected request: ${req.method} ${req.url}`);
      if (reply instanceof Error) throw reply;
      return { status: 200, headers: {}, body: '', url: req.url, durationMs: 120, ...reply };
    },
  };
}

export function dnsError(code: string): Error {
  return Object.assign(new Error(`query ${code}`), { code });
}

/** A DNS resolver backed by maps; missing names answer ENODATA like the real one. */
export function fakeDns({
  txt = {},
  mx = {},
}: {
  txt?: Record<string, string[] | Error>;
  mx?: Record<string, { exchange: string; priority: number }[] | Error>;
} = {}): DnsResolver & { txtQueries: string[] } {
  const txtQueries: string[] = [];
  return {
    txtQueries,
    async resolveTxt(hostname) {
      txtQueries.push(hostname);
      const answer = txt[hostname];
      if (answer instanceof Error) throw answer;
      if (!answer) throw dnsError('ENODATA');
      // Mimic chunking: the real resolver returns each record as string[].
      return answer.map((record) => record.match(/.{1,255}/g) ?? ['']);
    },
    async resolveMx(hostname) {
      const answer = mx[hostname];
      if (answer instanceof Error) throw answer;
      if (!answer) throw dnsError('ENODATA');
      return answer;
    },
  };
}

const unusedTls: TlsConnector = {
  handshake: () => Promise.reject(new Error('TLS not expected in this test')),
};

export function fakeDeps(overrides: Partial<CheckDeps> = {}): CheckDeps {
  return {
    http: fakeHttp({}),
    dns: fakeDns(),
    tls: unusedTls,
    clock: fixedClock(NOW),
    ...overrides,
  };
}

export const target = { domain: 'example.com' };

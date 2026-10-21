import http from 'node:http';
import https from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import type { HttpClient, HttpRequest, HttpResponse } from '../types.js';
import { isPublicAddress } from './ip-policy.js';

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

/** Resolves a hostname to every address it currently points at. */
export type LookupFn = (hostname: string) => Promise<ResolvedAddress[]>;

export type SafeFetchErrorCode =
  'BLOCKED_URL' | 'BLOCKED_ADDRESS' | 'DNS_FAILURE' | 'TIMEOUT' | 'TOO_LARGE' | 'NETWORK';

export class SafeFetchError extends Error {
  constructor(
    readonly code: SafeFetchErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SafeFetchError';
  }
}

export interface SafeHttpOptions {
  lookup: LookupFn;
  userAgent: string;
  connectTimeoutMs?: number;
  totalTimeoutMs?: number;
  maxBytes?: number;
}

/** Hard ceiling on redirects, whatever the caller asks for. */
export const MAX_REDIRECTS = 3;
const ALLOWED_PORTS = new Set([80, 443]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const REPO_URL = 'https://github.com/lavitsamson/sitesentinel-security-monitor';

export function buildUserAgent(version: string): string {
  return `SiteSentinel/${version} (+${REPO_URL})`;
}

/** Rejects anything but http(s) on ports 80/443 without embedded credentials. */
export function parseTarget(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SafeFetchError('BLOCKED_URL', `Invalid URL: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SafeFetchError('BLOCKED_URL', `Protocol ${url.protocol} is not allowed`);
  }
  if (url.username || url.password) {
    throw new SafeFetchError('BLOCKED_URL', 'URLs with credentials are not allowed');
  }
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  if (!ALLOWED_PORTS.has(port)) {
    throw new SafeFetchError('BLOCKED_URL', `Port ${port} is not allowed (only 80 and 443)`);
  }
  return url;
}

/**
 * Resolves the URL's host and returns one address to connect to. Every address
 * the name resolves to must be public: a name that answers with both a public
 * and a private address (a classic DNS-rebinding setup) is refused outright.
 */
export async function resolveTarget(
  url: URL,
  lookup: LookupFn,
  isAllowed: (address: string) => boolean = isPublicAddress,
): Promise<ResolvedAddress> {
  const host = url.hostname.replace(/^\[(.*)\]$/, '$1');
  const literal = isIP(host);
  if (literal) {
    if (!isAllowed(host)) {
      throw new SafeFetchError('BLOCKED_ADDRESS', `${host} is not a public address`);
    }
    return { address: host, family: literal as 4 | 6 };
  }

  let addresses: ResolvedAddress[];
  try {
    addresses = await lookup(host);
  } catch (err) {
    throw new SafeFetchError('DNS_FAILURE', `Could not resolve ${host}: ${errorMessage(err)}`);
  }
  const [first] = addresses;
  if (!first) throw new SafeFetchError('DNS_FAILURE', `${host} has no addresses`);
  const blocked = addresses.find((a) => !isAllowed(a.address));
  if (blocked) {
    throw new SafeFetchError(
      'BLOCKED_ADDRESS',
      `${host} resolves to ${blocked.address}, which is not a public address`,
    );
  }
  return first;
}

/**
 * A `lookup` for http.request that ignores the hostname and always answers with
 * the address already validated, so the socket connects to exactly what was
 * checked (no second DNS query for an attacker to change the answer to).
 */
export function pinnedLookup({ address, family }: ResolvedAddress): LookupFunction {
  return ((_hostname, options, callback) => {
    if (options.all) callback(null, [{ address, family }]);
    else callback(null, address, family);
  }) as LookupFunction;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function flattenHeaders(headers: http.IncomingHttpHeaders): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined) flat[name] = Array.isArray(value) ? value.join(', ') : value;
  }
  return flat;
}

interface HopResult {
  status: number;
  headers: Record<string, string>;
  body: string;
}

interface HopOptions extends Required<Omit<SafeHttpOptions, 'lookup' | 'totalTimeoutMs'>> {
  signal: AbortSignal;
}

function requestOnce(
  url: URL,
  target: ResolvedAddress,
  { method, headers: extraHeaders, body }: Pick<HttpRequest, 'method' | 'headers' | 'body'>,
  { userAgent, connectTimeoutMs, maxBytes, signal }: HopOptions,
): Promise<HopResult> {
  const isHttps = url.protocol === 'https:';
  const hostIsIp = isIP(url.hostname.replace(/^\[(.*)\]$/, '$1')) !== 0;

  return new Promise((resolve, reject) => {
    let connectTimer: NodeJS.Timeout | undefined;
    // Once the response has started, destroying the request surfaces as a generic
    // "aborted" error on the response, so remember why we destroyed it.
    let abortReason: SafeFetchError | undefined;
    const fail = (err: unknown) => {
      clearTimeout(connectTimer);
      if (abortReason) reject(abortReason);
      else if (err instanceof SafeFetchError) reject(err);
      else if (signal.aborted) {
        reject(new SafeFetchError('TIMEOUT', `Request to ${url.host} timed out`));
      } else {
        reject(
          new SafeFetchError('NETWORK', `Request to ${url.host} failed: ${errorMessage(err)}`),
        );
      }
    };

    const req = (isHttps ? https : http).request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method,
      headers: {
        accept: '*/*',
        ...extraHeaders,
        'user-agent': userAgent,
        'accept-encoding': 'identity',
        ...(body !== undefined && { 'content-length': String(Buffer.byteLength(body)) }),
      },
      lookup: pinnedLookup(target),
      // SNI must carry the hostname, never an IP (and is omitted for IP literals).
      ...(isHttps && !hostIsIp && { servername: url.hostname }),
      agent: false,
      signal,
    });
    const abort = (err: SafeFetchError) => {
      abortReason = err;
      req.destroy(err);
    };

    req.on('socket', (socket) => {
      if (!socket.connecting) return;
      connectTimer = setTimeout(() => {
        abort(
          new SafeFetchError(
            'TIMEOUT',
            `Connecting to ${url.host} took over ${connectTimeoutMs} ms`,
          ),
        );
      }, connectTimeoutMs);
      socket.once('connect', () => clearTimeout(connectTimer));
    });

    req.on('response', (res) => {
      clearTimeout(connectTimer);
      const status = res.statusCode ?? 0;
      const headers = flattenHeaders(res.headers);
      // Redirect bodies are never needed; HEAD has none.
      if (method === 'HEAD' || REDIRECT_STATUSES.has(status)) {
        res.resume();
        resolve({ status, headers, body: '' });
        return;
      }

      const tooLarge = () =>
        new SafeFetchError('TOO_LARGE', `Response from ${url.host} exceeds ${maxBytes} bytes`);
      if (Number(headers['content-length'] ?? 0) > maxBytes) {
        abort(tooLarge());
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) abort(tooLarge());
        else chunks.push(chunk);
      });
      res.on('end', () =>
        resolve({ status, headers, body: Buffer.concat(chunks).toString('utf8') }),
      );
      res.on('error', fail);
    });

    req.on('error', fail);
    req.end(body);
  });
}

/** Rejects once `signal` aborts, so a hanging DNS lookup cannot outlive the deadline. */
export function untilAborted<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  message: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new SafeFetchError('TIMEOUT', message));
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/**
 * The only way workers (and the API's verification step) make outbound HTTP
 * requests. Every hop is re-validated: URL shape, port, and the resolved
 * address, which is then pinned for the connection. See ADR 0002.
 */
export function createSafeHttpClient(options: SafeHttpOptions): HttpClient {
  const {
    lookup,
    userAgent,
    connectTimeoutMs = 5_000,
    totalTimeoutMs = 10_000,
    maxBytes = 1024 * 1024,
  } = options;

  return {
    async request(req: HttpRequest): Promise<HttpResponse> {
      const started = performance.now();
      const deadline = new AbortController();
      const timer = setTimeout(() => deadline.abort(), totalTimeoutMs);
      const hopOptions = { userAgent, connectTimeoutMs, maxBytes, signal: deadline.signal };
      const maxRedirects =
        req.body === undefined ? Math.min(Math.max(req.maxRedirects, 0), MAX_REDIRECTS) : 0;

      try {
        let url = parseTarget(req.url);
        for (let redirects = 0; ; redirects++) {
          const timeoutMessage = `Request to ${url.host} exceeded ${totalTimeoutMs} ms`;
          const target = await untilAborted(
            resolveTarget(url, lookup),
            deadline.signal,
            timeoutMessage,
          );
          const hop = await requestOnce(url, target, req, hopOptions);
          const location = hop.headers.location;
          if (REDIRECT_STATUSES.has(hop.status) && location && redirects < maxRedirects) {
            url = parseTarget(new URL(location, url).toString());
            continue;
          }
          return {
            ...hop,
            url: url.toString(),
            durationMs: Math.round(performance.now() - started),
          };
        }
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

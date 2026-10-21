import { isIP } from 'node:net';
import tls, { type DetailedPeerCertificate } from 'node:tls';
import type { PeerCertificateInfo, TlsConnector, TlsHandshakeResult } from '../types.js';
import { isPublicAddress } from './ip-policy.js';
import {
  SafeFetchError,
  errorMessage,
  parseTarget,
  resolveTarget,
  untilAborted,
  type LookupFn,
} from './safe-fetch.js';

export interface SafeTlsOptions {
  lookup: LookupFn;
  connectTimeoutMs?: number;
  totalTimeoutMs?: number;
  /**
   * Seams for the local TLS test server only (it listens on loopback, on a random
   * port, with a private CA). Production code never sets these.
   */
  unsafeTesting?: {
    port: number;
    ca?: string;
    isAllowedAddress: (address: string) => boolean;
  };
}

/** `CN=example.com, O=Example Ltd` from Node's parsed subject/issuer object. */
function formatName(name: Record<string, string | string[]> | undefined): string {
  if (!name) return '';
  return Object.entries(name)
    .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join('+') : value}`)
    .join(', ');
}

/** `DNS:a.com, IP Address:1.2.3.4` → `['a.com', '1.2.3.4']`. */
function parseAltNames(altNames: string | undefined): string[] {
  if (!altNames) return [];
  return altNames
    .split(/,\s*/)
    .map((entry) => /^(?:DNS|IP Address):(.+)$/.exec(entry)?.[1]?.trim())
    .filter((name): name is string => Boolean(name));
}

/** Walks the peer chain from the leaf up, stopping at the self-signed root. */
function toChain(leaf: DetailedPeerCertificate): PeerCertificateInfo[] {
  const chain: PeerCertificateInfo[] = [];
  const seen = new Set<string>();
  let cert: DetailedPeerCertificate | undefined = leaf;
  while (cert && cert.fingerprint256 && !seen.has(cert.fingerprint256)) {
    seen.add(cert.fingerprint256);
    chain.push({
      subject: formatName(cert.subject as unknown as Record<string, string>),
      issuer: formatName(cert.issuer as unknown as Record<string, string>),
      subjectAltNames: parseAltNames(cert.subjectaltname),
      validFrom: new Date(cert.valid_from),
      validTo: new Date(cert.valid_to),
    });
    cert = cert.issuerCertificate;
  }
  return chain;
}

/**
 * The only way workers open TLS connections (`safeConnect`). Same policy as
 * `safeFetch`: the hostname is resolved by us, every answer must be public, and
 * the socket connects to that exact address on port 443 with SNI set to the
 * hostname. Certificate problems are reported, not thrown, so the TLS check can
 * explain them; only network failures reject. See ADR 0002.
 */
export function createSafeTlsConnector(options: SafeTlsOptions): TlsConnector {
  const { lookup, connectTimeoutMs = 5_000, totalTimeoutMs = 10_000, unsafeTesting } = options;
  const port = unsafeTesting?.port ?? 443;
  const isAllowed = unsafeTesting?.isAllowedAddress ?? isPublicAddress;

  return {
    async handshake(hostname: string): Promise<TlsHandshakeResult> {
      const url = parseTarget(`https://${hostname}/`);
      const host = url.hostname;
      const deadline = new AbortController();
      const timeoutMessage = `TLS handshake with ${host} exceeded ${totalTimeoutMs} ms`;
      const timer = setTimeout(() => deadline.abort(), totalTimeoutMs);

      try {
        const target = await untilAborted(
          resolveTarget(url, lookup, isAllowed),
          deadline.signal,
          timeoutMessage,
        );
        return await new Promise<TlsHandshakeResult>((resolve, reject) => {
          const socket = tls.connect({
            host: target.address,
            port,
            // SNI and hostname verification use the name, never the pinned IP.
            ...(isIP(host) === 0 && { servername: host }),
            ...(unsafeTesting?.ca && { ca: unsafeTesting.ca }),
            // Read the certificate even when it is bad: reporting why is the point.
            rejectUnauthorized: false,
          });
          let settled = false;
          const finish = (err: SafeFetchError | null, result?: TlsHandshakeResult) => {
            if (settled) return;
            settled = true;
            clearTimeout(connectTimer);
            deadline.signal.removeEventListener('abort', onDeadline);
            socket.destroy();
            if (err) reject(err);
            else resolve(result as TlsHandshakeResult);
          };
          const onDeadline = () => finish(new SafeFetchError('TIMEOUT', timeoutMessage));
          deadline.signal.addEventListener('abort', onDeadline, { once: true });
          // Only fires asynchronously, after `finish` (which clears it) is defined.
          const connectTimer = setTimeout(() => {
            finish(
              new SafeFetchError(
                'TIMEOUT',
                `Connecting to ${host} took over ${connectTimeoutMs} ms`,
              ),
            );
          }, connectTimeoutMs);
          socket.once('connect', () => clearTimeout(connectTimer));

          socket.once('secureConnect', () => {
            const authError = socket.authorizationError as unknown;
            finish(null, {
              protocol: socket.getProtocol(),
              authorized: socket.authorized,
              authorizationError: authError ? String(authError) : null,
              chain: toChain(socket.getPeerCertificate(true)),
            });
          });
          socket.once('error', (err) => {
            finish(
              new SafeFetchError(
                'NETWORK',
                `TLS connection to ${host} failed: ${errorMessage(err)}`,
              ),
            );
          });
        });
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

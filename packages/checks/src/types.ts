import type { CheckStatus, Severity } from '@sitesentinel/shared';

/** A single observation produced by a check, always paired with a fix. */
export interface Finding {
  code: string;
  severity: Severity;
  message: string;
  recommendation: string;
}

export interface CheckResult {
  status: CheckStatus;
  /** 0–100, higher is better. */
  score: number;
  findings: Finding[];
  /** Check-specific evidence, stored size-capped alongside the run. */
  raw: Record<string, unknown>;
}

/** What a check is pointed at. `domain` is already normalised (lowercase, punycode). */
export interface CheckTarget {
  domain: string;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  /** Final URL after any redirects the client was asked to follow. */
  url: string;
  durationMs: number;
}

export interface HttpRequest {
  url: string;
  /** Checks only ever read (GET/HEAD); POST is for signed webhook alerts. */
  method: 'GET' | 'HEAD' | 'POST';
  /**
   * Maximum redirects to follow; 0 returns the first response as-is. Requests
   * with a body never follow redirects, so a webhook can't be bounced elsewhere.
   */
  maxRedirects: number;
  /** Extra request headers. The User-Agent is always SiteSentinel's own. */
  headers?: Record<string, string>;
  body?: string;
}

/** Outbound HTTP. In production this is the SSRF-guarded `safeFetch` (milestone 3). */
export interface HttpClient {
  request(req: HttpRequest): Promise<HttpResponse>;
}

/** Public DNS lookups, injected so tests never hit the network. */
export interface DnsResolver {
  resolveTxt(hostname: string): Promise<string[][]>;
  resolveMx(hostname: string): Promise<{ exchange: string; priority: number }[]>;
}

export interface PeerCertificateInfo {
  subject: string;
  issuer: string;
  subjectAltNames: string[];
  validFrom: Date;
  validTo: Date;
}

export interface TlsHandshakeResult {
  protocol: string | null;
  authorized: boolean;
  authorizationError: string | null;
  chain: PeerCertificateInfo[];
}

/** TLS handshake on port 443 with SNI. In production this is the SSRF-guarded `safeConnect`. */
export interface TlsConnector {
  handshake(hostname: string): Promise<TlsHandshakeResult>;
}

export interface Clock {
  now(): Date;
}

export interface CheckDeps {
  http: HttpClient;
  dns: DnsResolver;
  tls: TlsConnector;
  clock: Clock;
}

/** Every check is a pure function of its target and injected dependencies. */
export type Check = (target: CheckTarget, deps: CheckDeps) => Promise<CheckResult>;

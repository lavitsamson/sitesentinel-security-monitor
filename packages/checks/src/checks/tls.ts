import type { Check, Finding } from '../types.js';
import { DAY_MS, finding, resultFrom } from './result.js';

/** Fewer days than this left on the certificate is a warning. */
export const CERT_EXPIRY_WARNING_DAYS = 14;

const OUTDATED_PROTOCOLS = new Set(['SSLv3', 'TLSv1', 'TLSv1.1']);

/**
 * Verification errors the check reports in its own words (from the clock and
 * SANs), so they shouldn't also be reported as "untrusted".
 */
const EXPLAINED_ERRORS = new Set([
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

/**
 * RFC 6125 matching: exact, or a wildcard standing for exactly one leftmost
 * label (`*.example.com` matches `www.example.com`, not `example.com` or
 * `a.b.example.com`). The legacy subject CN is ignored, as browsers do.
 */
export function hostnameMatches(hostname: string, subjectAltNames: readonly string[]): boolean {
  const host = hostname.toLowerCase();
  return subjectAltNames.some((raw) => {
    const name = raw.toLowerCase();
    if (!name.startsWith('*.')) return name === host;
    const dot = host.indexOf('.');
    return dot > 0 && host.slice(dot + 1) === name.slice(2);
  });
}

export const tlsCheck: Check = async ({ domain }, { tls, clock }) => {
  const handshake = await tls.handshake(domain);
  const [leaf] = handshake.chain;
  if (!leaf) {
    return resultFrom(
      [
        finding(
          'TLS_NO_CERTIFICATE',
          'high',
          `${domain} completed a handshake without presenting a certificate.`,
          'Install a certificate for this domain on your web server or CDN; Let’s Encrypt issues them for free.',
        ),
      ],
      { protocol: handshake.protocol },
      { hardFail: true },
    );
  }

  const now = clock.now();
  const daysRemaining = Math.floor((leaf.validTo.getTime() - now.getTime()) / DAY_MS);
  const matches = hostnameMatches(domain, leaf.subjectAltNames);
  const findings: Finding[] = [];

  if (now > leaf.validTo) {
    findings.push(
      finding(
        'TLS_CERT_EXPIRED',
        'high',
        `The certificate expired on ${leaf.validTo.toISOString().slice(0, 10)}; browsers show a full-page warning.`,
        'Renew the certificate now, then automate renewal (for example certbot or your host’s auto-renew) so it can’t lapse again.',
      ),
    );
  } else if (now < leaf.validFrom) {
    findings.push(
      finding(
        'TLS_CERT_NOT_YET_VALID',
        'high',
        `The certificate only becomes valid on ${leaf.validFrom.toISOString().slice(0, 10)}.`,
        'Check the server clock and that the right certificate is installed.',
      ),
    );
  } else if (daysRemaining < CERT_EXPIRY_WARNING_DAYS) {
    findings.push(
      finding(
        'TLS_CERT_EXPIRING_SOON',
        'medium',
        `The certificate expires in ${daysRemaining} day(s).`,
        'Renew the certificate before it expires, and check that automatic renewal is actually running.',
      ),
    );
  }

  if (!matches) {
    findings.push(
      finding(
        'TLS_HOSTNAME_MISMATCH',
        'high',
        `The certificate does not cover ${domain} (it covers ${leaf.subjectAltNames.join(', ') || 'no names'}).`,
        `Issue a certificate that lists ${domain} in its Subject Alternative Names.`,
      ),
    );
  }

  const error = handshake.authorizationError;
  if (!handshake.authorized && error && !EXPLAINED_ERRORS.has(error)) {
    findings.push(
      finding(
        'TLS_CERT_UNTRUSTED',
        'high',
        `Browsers will not trust this certificate (${error}).`,
        'Use a certificate from a public CA and serve the full chain (leaf plus intermediates), not a self-signed one.',
      ),
    );
  }

  if (handshake.protocol && OUTDATED_PROTOCOLS.has(handshake.protocol)) {
    findings.push(
      finding(
        'TLS_PROTOCOL_OUTDATED',
        'medium',
        `The server negotiated ${handshake.protocol}, which is deprecated (RFC 8996).`,
        'Disable SSLv3, TLS 1.0 and TLS 1.1; enable TLS 1.2 and TLS 1.3.',
      ),
    );
  } else if (handshake.protocol === 'TLSv1.2') {
    findings.push(
      finding(
        'TLS_NO_TLS13',
        'info',
        'The server negotiated TLS 1.2 although TLS 1.3 was offered.',
        'Enable TLS 1.3 for faster, more private handshakes; keep TLS 1.2 for older clients.',
      ),
    );
  }

  return resultFrom(
    findings,
    {
      protocol: handshake.protocol,
      authorized: handshake.authorized,
      authorizationError: error,
      subject: leaf.subject,
      issuer: leaf.issuer,
      subjectAltNames: leaf.subjectAltNames,
      validFrom: leaf.validFrom.toISOString(),
      validTo: leaf.validTo.toISOString(),
      daysRemaining,
      hostnameMatches: matches,
      chain: handshake.chain.map((cert) => cert.subject),
    },
    { hardFail: findings.some((f) => f.severity === 'high') },
  );
};

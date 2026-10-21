# TLS test fixtures

A throwaway CA and one server certificate, used only by `safe-connect.test.ts` to run a
real TLS handshake against a local server on loopback. Nothing outside the tests trusts them.

- `ca.crt`: "SiteSentinel Test CA" (its private key was discarded after signing).
- `server.crt` / `server.key`: leaf for `tls.sitesentinel.test` and `*.wild.sitesentinel.test`,
  signed by the CA, valid until 2126.

Regenerate with OpenSSL (`req -x509` for the CA, then `x509 -req` with a `subjectAltName`
extension for the leaf) if they ever need to change.

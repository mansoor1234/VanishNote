# Vanishnote security model

Vanishnote is built so that the server can't read notes. This document says exactly what that
protects against and what it doesn't.

## Cryptography (all client-side, Web Crypto API)

| Item            | Choice                                                                    |
| --------------- | ------------------------------------------------------------------------- |
| Cipher          | AES-256-GCM, fresh random 96-bit IV per note                              |
| Link key        | 256 random bits, base64url, carried in the URL fragment (`#…`)            |
| Key derivation  | `HKDF-SHA256(linkKey, info="vanishnote/v1/link")`                         |
| With a password | `P = PBKDF2-SHA256(password, salt16, 600 000 iters)`, then `HKDF-SHA256(linkKey ‖ P, salt, info="vanishnote/v1/link+password")` |
| Note ID         | 128 random bits, base64url                                                |
| Delete token    | 256 random bits; server stores only its SHA-256                           |

Source: [`src/lib/crypto.ts`](src/lib/crypto.ts). Decrypting requires the link key, plus the
password when one is set. Any wrong key, wrong password or tampered byte gives the same
`DecryptionError`.

## What the server can see

- Ciphertext, IV, and (for password notes) the PBKDF2 salt and a `has_password` flag
- Expiry time, views remaining, creation time
- The creator's email address, if they asked for a read notification, until the row is deleted
- SHA-256 of the delete token
- The client IP for each request, used in memory for rate limiting and never stored or logged

## What the server never sees

- Plaintext
- The link key. URL fragments are not sent in HTTP requests.
- The password, or any verifier for it. The only way to test a password guess is to try
  decrypting the ciphertext, which needs the link key.

## Burn after read

- `GET /n/:id` never touches the database. It renders a "Reveal" page, so link-preview bots
  and mail scanners can't consume notes.
- `POST /api/notes/:id/read` consumes the note in one D1 batch (one transaction):
  `DELETE … WHERE reads_left <= 1 AND expires_at > now RETURNING …`, else
  `UPDATE … SET reads_left = reads_left - 1 WHERE reads_left > 1 AND expires_at > now RETURNING …`.
  Concurrent reads can't both get the last view. `tests/integration/api.test.ts` races 2 and 25
  concurrent readers against a real local D1.
- Missing, consumed, expired and malformed IDs all return the same 404 body.
- Expiry is enforced at read time. The hourly cron only cleans up.

## Hardening

- CSP `default-src 'none'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; …`
  with no inline scripts or styles. The only inline `<script>` is non-executable JSON-LD on
  marketing pages. Sent as an HTTP header by middleware (Worker-rendered routes) and
  `public/_headers` (static pages); a unit test keeps the two identical.
- `Referrer-Policy: no-referrer`, HSTS, `nosniff`, `X-Frame-Options: DENY`, restrictive
  `Permissions-Policy`, COOP/CORP `same-origin`.
- `/n/*`, `/d/*` and `/api/*`: `Cache-Control: no-store` and `X-Robots-Tag: noindex`.
- No third-party scripts, fonts or analytics anywhere.
- Decrypted text is set with `textContent` only (e2e-tested with an XSS payload).
- Strict zod validation, unknown fields rejected, a 128 KB body cap, and JSON-only bodies.
  Astro's origin check returns 403 for cross-site form-style POSTs.
- Per-IP rate limits (Workers Rate Limiting): create 10/min, read and delete 30/min.
- No request-body logging. Workers observability is disabled in `wrangler.toml` because
  invocation logs would record request URLs, which contain note IDs. Error logs carry only
  generic messages and HTTP status codes.

## Threats Vanishnote does not defend against

1. **Link interception.** Anyone with the full link can open the note, and the intended
   recipient will then see "already read". Use a password sent over a different channel.
2. **Offline password guessing after interception.** Someone who has the link but not the
   password can consume the note and brute-force the password offline against the ciphertext.
   600k PBKDF2 iterations slow this down, but only a strong passphrase defeats it.
3. **Compromised endpoints.** Malware, hostile browser extensions or shoulder-surfing on
   either device.
4. **A malicious or compromised server** serving modified JavaScript. Browsers can't pin web
   app code, so users trust each page load. Mitigations: strict CSP, no third-party code, and
   a small, auditable client.
5. **Recipient copies.** A recipient can always copy or screenshot what they're shown.
6. **Metadata.** The operator (and Cloudflare) can see that a note was created and read, when,
   and from which IP at request time, and can see notification email addresses.
7. **Rate limiting is approximate.** The Workers Rate Limiting binding is per-location and
   eventually consistent, so it deters abuse but isn't a hard global quota.

## Reporting

Email the address in `src/lib/site.ts` (`SECURITY_EMAIL`). Please allow reasonable time for a
fix before public disclosure.

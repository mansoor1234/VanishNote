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

| Attachments     | Sealed with the same note key (own IV); file name and type sealed separately. Ciphertext only in R2 |
| Login           | Browser sends `authKey = HKDF(PBKDF2-SHA256(password, SHA-256("vanishnote/v1/login:"+email), 600k))`; server stores `SHA-256(salt ‖ authKey)` |
| Requests        | ECDH P-256 key pair per request; private key (PKCS#8) sealed with `HKDF(PBKDF2(requestPassword, salt, 600k))`. Responder: ephemeral ECDH → `HKDF(shared, salt = epk ‖ pk, info="vanishnote/v1/request")` → AES-256-GCM |
| Push            | RFC 8291 (aes128gcm) payload encryption to the browser, RFC 8292 VAPID (ES256) |

Source: [`src/lib/crypto.ts`](src/lib/crypto.ts) and [`src/server/webpush.ts`](src/server/webpush.ts).
Decrypting requires the link key, plus the password when one is set. Any wrong key, wrong
password or tampered byte gives the same `DecryptionError`.

## Accounts

- **Passwords never leave the browser.** The server gets a 600k-iteration PBKDF2 derivation
  (via HKDF), so a stolen database still costs an attacker 600k PBKDF2 rounds per password guess.
  The server hashes that once more with a per-user salt. Workers caps PBKDF2 at 100k iterations
  and has a tight CPU budget, so the slow step deliberately happens client-side.
- **Sessions:** a random 256-bit token in an `HttpOnly; SameSite=Lax` cookie (`__Host-` prefix
  and `Secure` over HTTPS). Only its SHA-256 is stored. 30-day lifetime. Password changes and
  resets end every session.
- **Email tokens** (verification, reset, invitation) are random 256-bit, stored hashed,
  single-use (deleted in the statement that reads them) and short-lived. They travel in URL
  fragments and are only used on a button press, so mail scanners can't consume them.
- **No account enumeration** through sign-up, login, password reset or resend: the answer is the
  same whether or not an address is registered.
- **Two-factor sign-in** (optional, in Settings): after the password, a browser we don't recognise
  must enter a 6-digit code we email. Codes are uniformly random, stored only as
  `SHA-256(challengeId:code)`, valid for 10 minutes, allow 5 attempts, and a new sign-in replaces
  any pending code. A browser that completes sign-in gets a random 256-bit device cookie
  (`HttpOnly`, stored hashed, 90 days). Turning 2FA on or off needs the password; turning it off or
  resetting the password forgets every remembered device. A password reset link already proves
  control of the inbox, so it doesn't also ask for a code. The second factor is the email
  inbox, which is weaker than an authenticator app or a passkey.
- **API keys:** `vn_` + 256 random bits, shown once, stored as SHA-256. Creating or regenerating one
  needs the password. A key only works on note and request endpoints, never on account, team or
  security settings (password, 2FA, API key, deletion). Browsers can't send it cross-site, because
  we never answer CORS preflights, so it isn't exposed to CSRF.
- **Consent:** sign-up requires accepting the terms and privacy policy. We record which version
  (the `LEGAL_UPDATED` date in `src/lib/site.ts`) and when; Settings asks users to re-accept after
  that date changes.
- **Turnstile** guards sign-up, password reset and resend-verification. Without a secret it fails
  closed except on localhost.
- Monthly quotas are enforced with a single conditional `INSERT … ON CONFLICT DO UPDATE … WHERE`,
  so concurrent requests can't overshoot them (tested).

## Information requests

- The requester's browser makes a key pair and seals the private key with a request password
  that never leaves the browser. We store the public key and the sealed private key.
- The request link carries `SHA-256(publicKey)` in its fragment. The responder's browser refuses
  to encrypt if the key the server hands it doesn't match. When *we* email the link, you trust us
  not to swap both key and link; sharing the link yourself removes that trust.
- Exactly one response is accepted (one conditional `UPDATE`, race-tested). Opening it is two
  steps: the browser first unlocks the private key with the password (no side effects), and only
  then fetches and deletes the response. A mistyped password never costs the response.

## Notes sent from an account

- **Emailing a link** means our server briefly handles the link key in order to build the email.
  So we only allow it for **password-protected** notes: the key alone can't open them.
- **Titles, password hints and request messages are plaintext metadata**, visible to us and to
  teammates. The UI says so next to each field.
- **Attachments** are downloaded with a single-use token issued when the note is opened (10
  minutes). The encrypted file is queued for deletion as soon as its note is gone and deleted by
  the cron after a 15-minute grace period.
- **Activity history** stores event type, time and the country Cloudflare reports. It never
  stores IP addresses. Failed password attempts are reported by the recipient's browser (we
  can't detect them), so treat them as informative, not proof.
- **Branding** uses a public brand ID in the link (`?b=`) rather than looking up the note, so
  a note page still reveals nothing about whether the note exists. Logos are sniffed by content
  (PNG, JPEG or WebP only; SVG refused), stored in R2, and served with `CSP: default-src 'none'; sandbox`.

## What the server can see

- Ciphertext, IV, and (for password notes) the PBKDF2 salt and a `has_password` flag
- Expiry time, views remaining, creation time
- The creator's email address, if they asked for a read notification, until the row is deleted
- SHA-256 of the delete token
- For accounts: name, email, team, plan, note/request titles, password hints, request messages,
  activity history, push subscription endpoints, and encrypted attachment sizes
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
- `/n/*`, `/d/*`, `/r/*`, `/app/*`, `/api/*` and token pages: `Cache-Control: no-store` and
  `X-Robots-Tag: noindex`.
- No third-party scripts or fonts, with two path-scoped exceptions, each allowed by the CSP
  on its own paths only:
  - Cloudflare Turnstile on `/signup`, `/forgot` and `/verify`;
  - Google Analytics on the information pages in `ANALYTICS_PATHS` (`src/lib/analytics.ts`:
    pricing, FAQ, how it works, security, privacy, terms, blog), and only after the visitor
    opts in. Never on `/`, note, request or destroy pages, the dashboard, or log-in/sign-up, so
    no third-party code can read a link fragment, note text or password.
- Push is only sent to known push-service hosts (no SSRF through subscription endpoints).
- Decrypted attachments are always saved as downloads (`application/octet-stream`), never
  rendered, and file names are sanitised.
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

# Vanishnote — handoff for the next agent

Read this first, then `README.md` (setup, deploy, API) and `SECURITY.md` (threat model). This
file explains *why* the app is the way it is, the business rules, and the traps already found.
State as of 2026-10-15, last commit `7e2d4aa`.

---

## 1. What the product is

Vanishnote sends **encrypted, self-destructing notes**. A user writes a note, gets a one-time
link, the recipient opens it, and the note is destroyed after reading or at expiry.

**The core promise, and the main marketing message: "Notes even we can't read."** Notes are
encrypted in the browser. The key lives only in the link's URL fragment (after `#`), which
browsers never send to servers. The server stores ciphertext it has no way to decrypt. The
UI was recently redesigned to put this message front and centre (hero, live "what our server will
receive" preview, "readable at both ends, scrambled in the middle" diagram, link anatomy, badges).

It is an **original product** inspired by NoteShred's features and pricing. Do not copy
NoteShred's name, copy text, or visual design. Features and prices matching theirs is
intended.

Two ways to use it:
- **Quick notes** on the home page: no account, free, unlimited (rate-limited per IP), up to 7 days.
- **Accounts** (Free / Standard / Business): dashboard, attachments, activity history,
  information requests, teams, branding, push notifications, two-factor authentication, API key.

## 2. Non-negotiable invariants (do not break these)

1. **The server never receives plaintext, link keys, note passwords, request passwords or login
   passwords.** All encryption is in the browser (`src/lib/crypto.ts`, Web Crypto only, no
   crypto libraries). If a feature seems to need the server to see content, stop and ask the user.
   The one documented exception is emailing a note link (`/api/account/notes/:id/send`): the
   server briefly sees the link key, so it is allowed **only for password-protected notes**.
2. **`GET /n/:id` must never read or consume the note.** Chat apps' link-preview bots fetch links.
   Consumption happens only on `POST /api/notes/:id/read` after the user presses a button.
   Branding on that page comes from the `?b=<brandId>` query parameter, never from a note lookup.
3. **Burn-after-read is atomic.** It is one D1 `batch` (a transaction):
   `DELETE … RETURNING` for the last read, else `UPDATE reads_left - 1 … RETURNING`. Race tests
   prove that concurrent readers can't both win. Keep it that way (`src/server/db.ts`, `consumeNote`).
4. **Missing, consumed, expired and wrong-token notes all return the identical 404 body**
   ("This note doesn't exist or has already been read."). Never reveal which case it was.
5. **Decrypted text is set with `textContent` only.** Never use `innerHTML` with user data.
6. **Strict CSP with no inline scripts or styles.** No `style="…"` attributes and no inline
   `<script>` except JSON-LD data blocks. Astro bundles `<script>` tags into external files, so
   that is fine. Shiki is disabled because it emits inline styles. Turnstile's origin is allowed
   only on `/signup`, `/forgot` and `/verify`.
7. **No third-party scripts, fonts or analytics**, especially on `/n/*`, `/r/*` and `/d/*`.
8. **Never log request bodies, full note IDs or email addresses.** Workers observability is
   deliberately **off** in `wrangler.toml`, because request URLs contain note IDs.
9. **`noindex` and `no-store` on every private path:** `/n /d /r /api /app /verify /reset /join
   /forgot` (`isPrivatePath` in `src/server/http.ts`).
10. **Secrets are stored hashed:** sessions, email tokens, delete tokens, API keys, trusted
    devices and 2FA codes are stored only as SHA-256 hashes.

## 3. Stack

- **Astro 7** (`output: 'static'`; on-demand routes use `export const prerender = false`) with
  **`@astrojs/cloudflare` v14**, which uses `@cloudflare/vite-plugin`. Env vars come from
  `import { env } from 'cloudflare:workers'`; `locals.cfContext` is the `ExecutionContext`.
- **Cloudflare Workers** with a custom entry `src/worker.ts` (Astro `handle` plus the cron
  `scheduled` handler), **D1** (SQLite), **R2** (encrypted files and logos), the **Workers Rate
  Limiting** binding, a **Cron Trigger** (hourly) and **Turnstile**.
- **TypeScript 6** in strict mode. `@astrojs/check` doesn't support TS 7. `astro check` currently
  crashes with a V8 out-of-memory error, so use `npx tsc --noEmit` plus `npm run build` instead.
- **Tailwind CSS 4** via `@tailwindcss/vite`. Design tokens live in `src/styles/global.css`.
- **zod 4** for validation, **Resend** (HTTP API via `fetch`) for email, **Vitest 5** and
  **Playwright** for tests.
- Node ≥ 22.12, and the dev machine is **Windows** (see the traps in §11).

## 4. Running it

```sh
npm install
npm run db:migrate:local                 # apply migrations to the local D1 (.wrangler/state)
npm run build
npx wrangler dev --var DEV_OUTBOX:true   # http://localhost:8787
```
- `DEV_OUTBOX=true` writes emails to the `dev_outbox` table instead of sending them. Read them at
  `/api/dev/outbox?to=email`. This only works on localhost. **Never set it in production.**
- Without `TURNSTILE_SECRET_KEY`, Turnstile verification is skipped **only for localhost**
  requests and fails closed everywhere else.
- Code changes require a new `npm run build`, then restarting `wrangler dev`.
- `npm run test:e2e` rebuilds `dist/`, which kills any running `wrangler dev` on 8787. Restart it
  afterwards.
- To query the local DB: `npx wrangler d1 execute vanishnote-db --local --command "SELECT …"`

## 5. Repository map

```
src/lib/        Shared by browser and server
  crypto.ts       ALL client crypto: notes, attachments, login auth key, request ECDH keys, password generator
  encoding.ts     base64url and random bytes
  limits.ts       sizes, expiry options (quick notes: 1h/1d/7d; timed account notes up to 365d), ID regexes
  plans.ts        Free/Standard/Business: prices, limits, pricing table rows (single source of truth)
  schema.ts       zod schemas and response types for anonymous notes
  site.ts         CONTACT_EMAIL, SECURITY_EMAIL, LEGAL_UPDATED (terms version), cleanPath()
src/server/     Worker-side, framework-agnostic handlers (tests call them directly)
  api.ts          anonymous notes: create / read / delete-with-token
  router.ts       route table for every other API endpoint (auth, account, public request/file routes)
  context.ts      Ctx (env, request, url, now, waitUntil, country, user), AppEnv, appLink()
  auth.ts         sign-up, verify, login (+2FA), reset, sessions, device cookies, API-key auth
  account-notes.ts  account notes (multipart + R2), send link, records list/events/delete, downloads
  requests.ts     information requests: create, public respond, requester key + open
  team.ts         invites, members, join, branding (logo sniffing), public logo route
  settings.ts     profile, password, delete account, push devices, contact, 2FA, API key, consent, dev outbox
  records.ts      dashboard records + activity events, download grants, onAccountNoteRead
  db.ts           note SQL (insert, atomic consume, delete, purgeExpired)
  usage.ts        monthly quotas (atomic conditional upsert)
  cleanup.ts      hourly cron: expiry, retention, sessions/tokens/devices, orphaned R2 files
  mail.ts / templates.ts / email.ts   mailer (Resend or dev outbox), email bodies, legacy notifier
  notify.ts / webpush.ts   email + push to a user; RFC 8291/8292 Web Push on Web Crypto
  http.ts         JSON helpers, CSP and security headers, body readers (JSON and multipart)
  turnstile.ts / deps.ts   Turnstile verify; real bindings for Astro routes
src/pages/      Astro routes. Static: / pricing how-it-works security faq privacy terms blog 404
                On demand: n/[id] d/[id] r/[id] app/* login signup verify forgot reset join
                api/[...path].ts (→ router), api/notes/* (anonymous), brand/[brandId]/logo.ts
src/scripts/    Browser code (create, reveal, respond, auth, cipher-preview, app/* for the dashboard)
src/components/ CreateNote, PricingTable, ZeroKnowledgeBadge, LinkAnatomy, WhoSeesWhat, app/* dialogs, SettingsCard
src/layouts/    Base (site chrome or none), App (dashboard shell), Auth, Prose
src/middleware.ts  /app session guard; security headers for on-demand responses
public/_headers    the same security headers for static pages (a unit test keeps them identical)
public/sw.js       push-only service worker (no caching)
migrations/        0001 notes · 0002 accounts/teams/records/requests/usage/push · 0003 2FA/API key/consent
tests/unit         crypto, web push, headers, email, plans
tests/integration  real local D1 + R2 via wrangler getPlatformProxy (api.test.ts, accounts.test.ts)
tests/e2e          Playwright against the production build on workerd (flow.spec.ts, accounts.spec.ts)
scripts/           generate-og.mjs (social images and push icon), generate-vapid.mjs
```

## 6. Cryptography (`src/lib/crypto.ts`)

- **Note:** a random 32-byte link key goes in the fragment. Without a password,
  `K = HKDF(linkKey, info "vanishnote/v1/link")`. With a password,
  `P = PBKDF2-SHA256(pw, salt16, 600k)` and `K = HKDF(linkKey‖P, salt, info "…/link+password")`.
  Encryption is AES-256-GCM with a random 96-bit IV. Attachment bytes and their `{name,type}`
  metadata are sealed under the same K with separate IVs.
- **Wrong note password:** the server can't check it. Revealing consumes the note first, then the
  ciphertext stays in the tab for unlimited retries. Failed attempts are reported to
  `/api/notes/:id/events` for the activity log; that endpoint always returns 204.
- **Login:** `authKey = HKDF(PBKDF2(pw, SHA-256("vanishnote/v1/login:"+email), 600k))`. The server
  stores `SHA-256(salt‖authKey)`. The slow step is in the browser on purpose: Workers caps PBKDF2
  at 100k iterations and has a tight CPU budget.
- **Information requests:** the requester's browser makes an ECDH P-256 key pair and wraps the
  private key (PKCS#8) with `HKDF(PBKDF2(requestPassword))`. The responder encrypts with an
  ephemeral ECDH key pair. The link fragment carries `SHA-256(publicKey)` so the responder can
  detect a swapped key. Opening is two steps: unlock the key locally (no side effects), then
  `POST …/open` fetches and deletes the response.
- **Web Push:** aes128gcm payloads plus VAPID ES256, verified against an independent decryptor in tests.

## 7. Data model (D1)

- **`notes`:** the encrypted payload for anonymous and account notes. Key columns:
  `reads_left` (1–10), `burn_on_read` (0 = "after a set time"), `expires_at`, `team_id` (account
  notes), `password_hint`, `file_*` (R2 key, IV, encrypted metadata), `delete_token_hash`.
- **`records` + `record_events`:** dashboard metadata and activity for account notes and requests.
  These outlive the payload until `retain_until`. Statuses for notes:
  active / shredded / expired / destroyed. For requests: pending / completed / opened / expired.
- **`requests`:** public key, wrapped private key, message, and the response ciphertext plus file.
- **`teams`:** plan, seats and brand. Every user belongs to exactly one team; sign-up creates a
  personal team with the user as owner.
- **`users`:** email, name, auth hash, verified, `two_factor`, `api_key_hash` and prefix, `terms_version` and `terms_accepted_at`.
- **Supporting tables:** `sessions`, `email_tokens` (verify/reset/invite), `trusted_devices`,
  `login_challenges`, `usage` (team, month), `download_grants`, `orphan_files`,
  `push_subscriptions`, `dev_outbox`.
- All timestamps are **epoch milliseconds**. IDs are base64url (128-bit for notes and requests).
- **New schema = new migration file** (`migrations/0004_…sql`). Never edit an applied one.

## 8. Business rules

**Plans** (`src/lib/plans.ts`, enforced server-side; the pricing page renders from this file):

| | Free | Standard | Business |
|---|---|---|---|
| Price | $0 | $5 / user / month ($4 yearly) | $30 / month flat ($24 yearly). Marked "Most popular" |
| Notes per month | 5 | unlimited | unlimited |
| Requests per month | 2 | unlimited | unlimited |
| Attachment size | 5 MB | 25 MB | 25 MB |
| Retention | 7 days | 6 months (183 d) | 12 months |
| Users | 1 | seats | unlimited |
| Shared team notes, branding, activity kept after shred | no | yes | yes |

- Quotas are per team per UTC month, enforced atomically (`usage.ts`; a concurrency test exists).
- **Quick notes** (no account) have no quota, are rate-limited per IP, offer 1h/1d/7d expiry, and
  have no attachments. A unit test pins the 7-day maximum to the Free plan's retention.
- **Account notes:** "shred after reading" (1–10 views; unread notes deleted at retention) or
  "after a set time" (readable until expiry; downloading the attachment shreds it). Timed options
  are capped by plan retention.
- **Free plan:** activity history is deleted when a note is shredded. Paid plans keep it until retention ends.
- **Billing is not wired up.** Upgrade buttons go to the Contact form. An operator changes plans with SQL:
  `UPDATE teams SET plan='business' WHERE id=(SELECT team_id FROM users WHERE email='…')`.
- **Rate limits** (`wrangler.toml`): CREATE 10/min, READ 30/min, AUTH 10/min, per IP.
- **2FA (optional):** an unrecognised browser gets an emailed 6-digit code (10 minutes, 5
  attempts). Completed sign-ins get a 90-day device cookie. Toggling needs the password. A
  password reset forgets all remembered devices.
- **API key:** `Authorization: Bearer vn_…`, shown once. It works only on routes marked
  `apiKey: true` in `router.ts` (records, notes, requests), never on account or security settings.
- **Consent:** sign-up requires `acceptTerms: true`. The version (`LEGAL_UPDATED`) and time are
  stored. Settings shows "Review needed" when the version changes.
- **Information request responders** need no account, and each request accepts exactly one
  response (a conditional UPDATE).

## 9. API surface

- **Anonymous notes:** `POST /api/notes`, `POST /api/notes/:id/read`, `DELETE /api/notes/:id`
  (with the delete token).
- **Everything else is in `src/server/router.ts`:** `/api/auth/*` (signup, verify, resend, login,
  login/code, logout, forgot, reset), `/api/account/*` (records, notes, requests, team, settings,
  push, 2fa, api-key, consent, contact), and the public `/api/requests/:id/respond`,
  `/api/files/:token` (single-use download grant, 10 minutes) and `/api/notes/:id/events`.
- **Errors** are `{ error: code, message: human text }`. 429 responses include `Retry-After`. The
  browser clients handle 401 by redirecting to `/login`.
- **README "API" section** documents external use. The user compared it with
  https://www.noteshred.com/api (see §12).

## 10. Testing

- `npm test`: 103 unit and integration tests, including race tests for burn-after-read, quotas
  and request responses. `npm run test:e2e`: 18 Playwright tests, including sign-up, 2FA across two
  browser contexts, the attachment round trip, the request round trip, and CSP-clean pages.
- E2E tests give each test a random `CF-Connecting-IP` (`tests/e2e/client-ip.ts`) so the per-IP
  rate limits don't trip. The server runs with `--var DEV_OUTBOX:true` so tests can read emails.
- Lighthouse scores were 100/100/100/100 on the marketing pages at the last check.
- Run `npx tsc --noEmit`, `npm test` and `npm run test:e2e` before committing.

## 11. Traps already hit (save yourself the time)

- **Workers types vs DOM:** in browser scripts, `element.append(...)` fails to type-check
  (HTMLRewriter types). Use `appendChild`, and type DOM roots as `HTMLElement | Document`, not
  `ParentNode`.
- **D1:** binding parameters the SQL doesn't use can error. Write conditional SQL
  (`?3 IS NULL OR col = ?3`) instead of building the parameter list dynamically.
- **R2 `put()`** rejects streams of unknown length. Pass `await file.arrayBuffer()`.
- **Tailwind 4:** you can't `@apply` a class from `@layer components`. Composable bases (`btn`,
  `notice`, `link`) are `@utility`. The important modifier is a trailing `!` (`mb-0!`).
- **Prose links:** `.prose-page a` excludes `.btn-*` classes. Button-styled links once rendered
  invisible because of this, so keep the exclusion.
- **Dark mode:** use token pairs (e.g. `bg-danger text-danger-ink`). Check WCAG AA contrast in
  both themes.
- **Windows shell:** PowerShell `Set-Content -Encoding utf8` adds a BOM (it broke
  `package.json`), and `-Encoding ascii` mangles `…`. Prefer the Edit tool. `python -` hangs (it
  opens the Windows Store stub). Bash heredocs with quotes are fragile; write files with the Write tool.
- **Astro origin check** blocks cross-site form-type POSTs. JSON and API-key clients without an
  `Origin` header pass. That's intended.
- `build.format: 'file'` makes prerendered pathnames end in `.html`. Use `cleanPath()` for
  canonical URLs and nav state.
- `APP_URL` is used for links in emails, never the request Host header. Locally it is
  `http://localhost:8787`.
- Turnstile's script loads only on pages using `Auth.astro` with `turnstile` set, and the CSP for
  those paths is `TURNSTILE_CSP`.

## 12. Open items and decisions waiting on the user

- **Hosting decision (latest discussion):** the user wants **no monthly bills**, with a yearly
  budget of about 10,000 PKR (~$35). The recommendation was **Cloudflare free plans (Workers, D1,
  R2, Turnstile) plus Resend free plus a yearly domain (~3,000 PKR)**, with no code changes. The
  risk is the Workers Free CPU limit per request (error 1102). The fallback is porting to a
  yearly VPS (Node adapter, SQLite file, disk storage, node-cron, an in-process rate limiter),
  which would take a few days. The user hasn't chosen a domain yet.
- **Not deployed yet.** Before deploying, these placeholders must be filled:
  - `database_id` in `wrangler.toml`;
  - `APP_URL`, `EMAIL_FROM`, `TURNSTILE_SITE_KEY`, `VAPID_*` and a `[[routes]]` custom domain;
  - the secrets `RESEND_API_KEY`, `TURNSTILE_SECRET_KEY` and `VAPID_PRIVATE_KEY`;
  - the contact addresses in `src/lib/site.ts`.

  The steps are in the README's "Deploy" section.
- **NoteShred API parity gaps (offered, not done):**
  1. a "shred" endpoint that destroys the content but keeps the record (status `destroyed`);
  2. an optional `message` on `/api/account/notes/:id/send`.

  A NoteShred-compatible layer (`/api/v2` paths, `Token token=` header, `{message,result}`
  envelope) was discussed. **Accepting plaintext content and passwords server-side was flagged
  as breaking the core promise. Don't do it without explicit user approval.**
- **Billing (Stripe) is not connected.** Plans are set by SQL; Stripe was deliberately postponed.
- **Not verified end to end against real services:** Resend delivery, Turnstile with real keys,
  Web Push delivery to a real device, and R2/cron in production.
- **The legal pages** (terms, privacy) are sensible drafts, not lawyer-reviewed.

## 13. Local state and user preferences

- **The user's local account** is `m.mansoorbahadur@techleadz.com`, manually verified and set to the
  **business** plan in the local D1. It hasn't re-accepted the terms, so it shows "Review needed".
- **No approval needed for file edits** in this repo; the user said not to ask. Still confirm
  deploys, deleting data, and anything sent to real people.
- **Commit in logical steps** and end commit messages with the attribution trailer
  (`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).
- **Write user-facing copy** in plain, calm English. Every security claim must be accurate (no
  "unhackable"). If you change what the server sees, update `SECURITY.md` and the privacy page.

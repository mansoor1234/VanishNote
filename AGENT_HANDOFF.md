# Vanishnote — handoff for the next agent

Read this first, then `README.md` (setup, deploy, API, SSO and extension setup) and `SECURITY.md`
(threat model). This file explains *why* the app is the way it is, the business rules, and the
traps already found. State as of 2026-10-24, after commit `35c5499` (live on vanishnote.net).

---

## 1. What the product is

Vanishnote sends **encrypted, self-destructing notes**. A user writes a note, gets a one-time
link, the recipient opens it, and the note is destroyed after reading or at expiry.

**The core promise, and the main marketing message: "Notes even we can't read."** Notes are
encrypted in the browser. The key lives only in the link's URL fragment (after `#`), which
browsers never send to servers. The server stores ciphertext it has no way to decrypt. The UI
puts this front and centre (hero, live "what our server will receive" preview, "readable at both
ends, scrambled in the middle" diagram, link anatomy, badges).

It is an **original product** inspired by NoteShred's features and pricing. Do not copy
NoteShred's name, copy text, or visual design. Features and prices matching theirs is intended.

Ways to use it:
- **Quick notes** on the home page: no account, free, unlimited (rate-limited per IP), up to 7 days.
- **Accounts** (Free / Standard / Business): dashboard, attachments, activity history,
  information requests, teams, branding, push notifications, two-factor sign-in, API key,
  sign in with Google/Microsoft, and on paid plans an admin page (policies, audit log).
- **Browser extension** (Chrome, Edge, Firefox): toolbar popup and right-click "Send as a
  self-destructing Vanishnote". Quick notes without an account; with an API key, notes go to the
  dashboard. Built, **not yet published** to the stores. The site has an `/extension` page and an
  "Add to Chrome / Edge / Firefox" header button.

## 2. Non-negotiable invariants (do not break these)

1. **The server never receives plaintext, link keys, note passwords, request passwords or login
   passwords.** All encryption is in the browser or extension (`src/lib/crypto.ts`, Web Crypto
   only, no crypto libraries). If a feature seems to need the server to see content, stop and ask
   the user. The one documented exception is emailing a note link (`/api/account/notes/:id/send`):
   the server briefly sees the link key, so it is allowed **only for password-protected notes**.
2. **`GET /n/:id` must never read or consume the note.** Chat apps' link-preview bots fetch links.
   Consumption happens only on `POST /api/notes/:id/read` after the user presses a button.
   Branding on that page comes from the `?b=<brandId>` query parameter, never from a note lookup.
3. **Burn-after-read is atomic.** It is one D1 `batch` (a transaction):
   `DELETE … RETURNING` for the last read, else `UPDATE reads_left - 1 … RETURNING`. Race tests
   prove that concurrent readers can't both win (`src/server/db.ts`, `consumeNote`).
4. **Missing, consumed, expired and wrong-token notes all return the identical 404 body**
   ("This note doesn't exist or has already been read."). Never reveal which case it was.
5. **Decrypted text is set with `textContent` only.** Never use `innerHTML` with user data.
6. **Strict CSP with no inline scripts or styles.** No `style="…"` attributes and no inline
   `<script>` except JSON-LD data blocks. Astro bundles `<script>` tags into external files, so
   that is fine. Shiki is disabled because it emits inline styles. SVG presentation attributes
   (`fill`, `stop-color`) are fine. SSO uses plain links and server redirects, never forms.
7. **No third-party scripts or fonts on any page that handles notes, keys or passwords** (`/`,
   `/n/*`, `/r/*`, `/d/*`, `/app/*`, login/sign-up). The only exceptions are path-scoped:
   Turnstile on `/signup`, `/forgot`, `/verify` (`TURNSTILE_CSP`), and opt-in Google Analytics
   (`G-EZDT80VC6P`) on the information pages in `ANALYTICS_PATHS` (`src/lib/analytics.ts`:
   pricing, extension, faq, how-it-works, security, privacy, terms, blog). `public/_headers` swaps
   in `ANALYTICS_CSP` on exactly those paths (a unit test checks). Never widen that list to a page
   with a note form, a note link or a password field.
8. **Never log request bodies, full note IDs or email addresses.** Workers observability is
   deliberately **off** in `wrangler.toml`, because request URLs contain note IDs.
9. **`noindex` and `no-store` on every private path:** `PRIVATE_PATH` in
   `src/lib/private-paths.ts` (`/n /d /r /api /app /verify /reset /join /forgot`). The same rule
   keeps those pages out of the sitemap.
10. **Secrets are stored hashed:** sessions, email tokens, delete tokens, API keys, trusted
    devices, 2FA codes and SSO states are stored only as SHA-256 hashes.
11. **Team policies are enforced on the server**, whatever the client (dashboard, API key,
    extension). Client-side checks are only for nicer messages.
12. **The extension asks for the minimum:** `contextMenus`, `storage`, and the Vanishnote origin.
    It can't read pages. The privacy page, `/extension` page and `SECURITY.md` say so; any feature
    that reads pages (see §12 "paste protection") must be opt-in and update all three.

## 3. Stack

- **Astro 7** (`output: 'static'`; on-demand routes use `export const prerender = false`) with
  **`@astrojs/cloudflare` v14**, which uses `@cloudflare/vite-plugin`. Env vars come from
  `import { env } from 'cloudflare:workers'`; `locals.cfContext` is the `ExecutionContext`.
- **Cloudflare Workers** with a custom entry `src/worker.ts` (Astro `handle` plus the cron
  `scheduled` handler), **D1** (SQLite), **R2** (encrypted files and logos), the **Workers Rate
  Limiting** binding, a **Cron Trigger** (hourly) and **Turnstile**.
- **TypeScript 6** in strict mode (`tsconfig.json` includes `src`, `tests`, `extension/src`).
  `astro check` crashes with a V8 out-of-memory error, so use `npx tsc --noEmit` plus
  `npm run build` instead.
- **Tailwind CSS 4** via `@tailwindcss/vite`. Design tokens live in `src/styles/global.css`.
- **zod 4** for validation, **Resend** (HTTP API via `fetch`) for email, **Vitest 5** and
  **Playwright** for tests, **esbuild** (already a dependency) for the extension bundle.
- Node ≥ 22.12, and the dev machine is **Windows** (see the traps in §11).
- **Source:** GitHub `mansoor1234/VanishNote` (private), branch `main`, remote `origin`.

## 4. Running it

```sh
npm install
npm run db:migrate:local                 # apply migrations to the local D1 (.wrangler/state)
npm run build
npx wrangler dev --var DEV_OUTBOX:true   # http://localhost:8787
```
- `.dev.vars` (not committed; copy `.dev.vars.example`) overrides `wrangler.toml`'s production
  `APP_URL` and Turnstile key locally.
- `DEV_OUTBOX=true` writes emails to the `dev_outbox` table instead of sending them. Read them at
  `/api/dev/outbox?to=email`. This only works on localhost. **Never set it in production.**
- Without `TURNSTILE_SECRET_KEY`, Turnstile verification is skipped **only for localhost**
  requests and fails closed everywhere else.
- Code changes require a new `npm run build`, then restarting `wrangler dev`.
- To try SSO buttons locally: `--var GOOGLE_CLIENT_ID:x --var GOOGLE_CLIENT_SECRET:y` (they
  appear; the real flow needs real credentials and a registered localhost redirect URI).
- Extension: `npm run build:extension` (production) or
  `node scripts/build-extension.mjs --server http://localhost:8787`, then load
  `dist-extension/chrome` unpacked.
- To query the local DB: `npx wrangler d1 execute vanishnote-db --local --command "SELECT …"`

## 5. Repository map

```
src/lib/        Shared by browser and server
  crypto.ts       ALL client crypto: notes, attachments, login auth key, request ECDH keys, password generator
  encoding.ts     base64url and random bytes
  limits.ts       sizes, expiry options (quick notes: 1h/1d/7d; timed account notes up to 365d), ID regexes
  plans.ts        Free/Standard/Business: prices, limits (incl. teamAdmin, ssoEnforcement), pricing rows
  policy.ts       team policies: effectivePolicy (plan-limited), maxLifetimeDays, allowedTimedExpiries
  schema.ts       zod schemas and response types for anonymous notes
  site.ts         CONTACT_EMAIL, SECURITY_EMAIL, LEGAL_UPDATED (terms version), cleanPath()
  private-paths.ts  PRIVATE_PATH: noindex/no-store headers and the sitemap filter
  analytics.ts    GA ID, ANALYTICS_PATHS (where opt-in analytics may run), consent key
  extension-store.ts  EXTENSION_STORES (store URLs, empty until published), browser detection
src/server/     Worker-side, framework-agnostic handlers (tests call them directly)
  api.ts          anonymous notes: create / read / delete-with-token
  router.ts       route table for every other API endpoint (auth, SSO, account, team, public routes)
  context.ts      Ctx (env, request, url, now, waitUntil, country, user), AppEnv, appLink()
  auth.ts         sign-up, verify, login (+2FA, SSO-required check), reset, sessions, device cookies, API-key auth
  sso.ts          Google/Microsoft OpenID Connect (PKCE, state cookie, verified-email matching), link/unlink
  audit.ts        audit log: AUDIT_ACTIONS, write helpers, listing, CSV (formula-safe)
  account-notes.ts  account notes (multipart or JSON + R2), policy enforcement, send link, records, downloads
  requests.ts     information requests: create (policy lifetime), public respond, requester key + open
  team.ts         invites, members, join, branding, policies, shred a member, audit CSV, GET policy
  settings.ts     profile, password, delete account, push, contact, 2FA, API key, consent, dev outbox
  records.ts      dashboard records (+ member filter) and activity events, download grants
  db.ts           note SQL (insert, atomic consume, delete, purgeExpired)
  usage.ts        monthly quotas (atomic conditional upsert)
  cleanup.ts      hourly cron: expiry, retention, sessions/tokens/devices/SSO states, audit log, orphaned R2 files
  mail.ts / templates.ts / email.ts   mailer (Resend or dev outbox), email bodies, legacy notifier
  notify.ts / webpush.ts   email + push to a user; RFC 8291/8292 Web Push on Web Crypto
  http.ts         JSON helpers, CSP variants and security headers, body readers (JSON and multipart)
  turnstile.ts / deps.ts   Turnstile verify; real bindings for Astro routes
src/pages/      Astro routes. Static: / pricing extension how-it-works security faq privacy terms blog 404
                SEO pages (lib/guides.ts): send-password-securely one-time-secret-link share-api-keys
                password-generator privnote-alternative onetimesecret-alternative
                On demand: n/[id] d/[id] r/[id] app/* (index team admin settings subscription contact)
                login signup verify forgot reset join; api/[...path].ts (→ router), api/notes/*,
                brand/[brandId]/logo.ts, robots.txt.ts
src/scripts/    Browser code (create, reveal, respond, auth, cipher-preview, analytics, extension-cta, app/*)
src/components/ Header (Add-to-browser button), Footer, Logo, CreateNote, PricingTable, SsoButtons,
                AnalyticsConsent, ZeroKnowledgeBadge, LinkAnatomy, WhoSeesWhat, app/* dialogs, SettingsCard,
                FaqList, RelatedGuides, ComparisonTable
src/assets/logo-mark.svg   the logo mark: single source for header, favicons, icons, social cards
src/layouts/    Base (site chrome or none), App (dashboard shell), Auth, Prose, Landing (SEO page + note form)
src/middleware.ts  /app session guard; security headers for on-demand responses
public/_headers    security headers for static pages (+ analytics CSP blocks); unit-tested against http.ts
public/            favicon.svg/.ico/-48/-96, apple-touch-icon, icon-192, og images, extension-popup-*.png, sw.js
extension/         src/ (client.ts crypto+API, popup, options, background, ext.ts), static/ (html, css, icons), version.json
migrations/        0001 notes · 0002 accounts/teams/records/requests/usage/push · 0003 2FA/API key/consent
                   · 0004 team policies + audit_log · 0005 SSO (has_password, user_identities, sso_states)
tests/unit         crypto, web push, headers (incl. analytics CSP), email, plans, extension client, extension store
tests/integration  real local D1 + R2 via wrangler getPlatformProxy (api.test.ts, accounts.test.ts)
tests/e2e          Playwright on the production build (flow, accounts, extension specs)
scripts/           generate-og.mjs (logo-derived icons, social cards, extension icons), generate-vapid.mjs,
                   build-extension.mjs (Chrome + Firefox builds and store zips), screenshot-extension.mjs
```

## 6. Cryptography (`src/lib/crypto.ts`)

- **Note:** a random 32-byte link key goes in the fragment. Without a password,
  `K = HKDF(linkKey, info "vanishnote/v1/link")`. With a password,
  `P = PBKDF2-SHA256(pw, salt16, 600k)` and `K = HKDF(linkKey‖P, salt, info "…/link+password")`.
  Encryption is AES-256-GCM with a random 96-bit IV. Attachment bytes and their `{name,type}`
  metadata are sealed under the same K with separate IVs. The extension uses this same code.
- **Wrong note password:** the server can't check it. Revealing consumes the note first, then the
  ciphertext stays in the tab for unlimited retries. Failed attempts are reported to
  `/api/notes/:id/events` for the activity log; that endpoint always returns 204.
- **Login:** `authKey = HKDF(PBKDF2(pw, SHA-256("vanishnote/v1/login:"+email), 600k))`. The server
  stores `SHA-256(salt‖authKey)`. The slow step is in the browser on purpose: Workers caps PBKDF2
  at 100k iterations and has a tight CPU budget. The login password never encrypts notes, which
  is why SSO doesn't weaken the zero-knowledge promise.
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
  active / shredded / expired / destroyed. For requests: pending / completed / opened / expired / destroyed.
- **`requests`:** public key, wrapped private key, message, and the response ciphertext plus file.
- **`teams`:** plan, seats, brand, and policies (`policy_require_password`, `policy_max_expiry`
  = a `TIMED_EXPIRY_DAYS` key or NULL, `policy_require_sso`). Every user belongs to exactly one
  team; sign-up creates a personal team with the user as owner.
- **`users`:** email, name, auth hash, `email_verified_at`, `has_password` (0 for accounts created
  via Google/Microsoft), `two_factor`, `api_key_hash` and prefix, `terms_version`, `terms_accepted_at`.
- **`audit_log`:** team, actor id + name (snapshot), action (`AUDIT_ACTIONS`), target (title,
  name or email), country, time. Deleted after the plan's retention.
- **`user_identities`** (provider, subject → user; Microsoft subject is `tid:oid`) and
  **`sso_states`** (hashed state, nonce, PKCE verifier, mode login/signup/link, 10 minutes).
- **Supporting tables:** `sessions`, `email_tokens` (verify/reset/invite), `trusted_devices`,
  `login_challenges`, `usage` (team, month), `download_grants`, `orphan_files`,
  `push_subscriptions`, `dev_outbox`.
- All timestamps are **epoch milliseconds**. IDs are base64url (128-bit for notes and requests).
- **New schema = new migration file** (`migrations/0006_…sql`). Never edit an applied one.
  **Apply it remotely before deploying code that reads it** (`USER_COLUMNS` in `auth.ts` selects
  team policy columns on every signed-in request, so a missing column breaks every dashboard page).

## 8. Business rules

**Plans** (`src/lib/plans.ts`, enforced server-side; the pricing page renders from this file):

| | Free | Standard | Business |
|---|---|---|---|
| Price | $0 | $5 / user / month ($4 yearly) | $30 / month flat ($24 yearly). Marked "Most popular" |
| Notes per month | unlimited (like home-page quick notes) | unlimited | unlimited |
| Requests per month | 2 | unlimited | unlimited |
| Attachment size | 5 MB | 25 MB | 25 MB |
| Retention | 7 days | 6 months (183 d) | 12 months |
| Users | 1 | seats | unlimited |
| Shared team notes, branding, activity kept after shred | no | yes | yes |
| Admin: policies, audit log + CSV, shred a member (`teamAdmin`) | no | yes | yes |
| Require Google/Microsoft sign-in for members (`ssoEnforcement`) | no | no | yes |
| Sign in with Google/Microsoft | yes | yes | yes |

- Quotas are per team per UTC month, enforced atomically (`usage.ts`; a concurrency test covers
  the 2-request Free limit and the monthly reset).
- **Quick notes** (no account) have no quota, are rate-limited per IP, offer 1h/1d/7d expiry, and
  have no attachments. A unit test pins the 7-day maximum to the Free plan's retention.
- **Account notes:** "shred after reading" (1–10 views; unread notes deleted at the lifetime
  limit) or "after a set time" (readable until expiry; downloading the attachment shreds it).
  The lifetime limit is the plan's retention, or the team policy's maximum if shorter
  (`maxLifetimeDays`). Requests use the same limit; their history keeps the plan's retention.
- **Free plan:** activity history is deleted when a note is shredded. Paid plans keep it until retention ends.
- **Policies** (owner only, `/app/admin`): require a password on every note (server checks a salt
  is present), maximum lifetime, and on Business "members must use Google/Microsoft". Policies
  stop applying if the team drops to Free. Errors use code `policy`.
- **Audit log:** sign-ins (with method), notes/requests created, destroyed, cancelled, deleted,
  invites, joins, removals, shredding a member, renames, branding, policy changes, 2FA on/off,
  API key created/revoked, SSO connect/disconnect. Owner-only; CSV export at
  `/api/account/team/audit.csv`.
- **SSO** (`sso.ts`): log in, sign up (click-to-accept terms notice, version recorded), or connect
  from Settings. Existing accounts are matched by email only if the provider verified it (Google
  `email_verified`; Microsoft personal accounts or `xms_edov`). Matching an unconfirmed account
  wipes its password and sessions (pre-registration takeover). SSO sign-in skips the email-code
  2FA. SSO-created accounts have no usable password until set via "Forgot password"; the last
  sign-in method can't be disconnected. With the Business SSO policy, members' password logins
  and password resets are refused; the owner can always use a password.
- **Billing is not wired up.** Upgrade buttons go to the Contact form. An operator changes plans with SQL:
  `UPDATE teams SET plan='business' WHERE id=(SELECT team_id FROM users WHERE email='…')`.
- **Rate limits** (`wrangler.toml`): CREATE 10/min, READ 30/min, AUTH 10/min, per IP.
- **2FA (optional):** an unrecognised browser gets an emailed 6-digit code (10 minutes, 5
  attempts). Completed sign-ins get a 90-day device cookie. Toggling needs the password. A
  password reset forgets all remembered devices.
- **API key:** `Authorization: Bearer vn_…`, one per user, shown once; creating a new one revokes
  the old one (creating needs the password). It works only on routes marked `apiKey: true` in
  `router.ts` (records, notes, requests, policy), never on account or security settings.
- **Consent:** sign-up requires `acceptTerms: true`. The version (`LEGAL_UPDATED`, now
  2026-10-17) and time are stored. Settings shows "Review needed" when the version changes. Bump
  it when the privacy policy changes materially.
- **Information request responders** need no account, and each request accepts exactly one
  response (a conditional UPDATE).
- **Extension:** without a key, quick notes (POST `/api/notes`, with a destroy link). With a key,
  account notes as JSON to `/api/account/notes`; the form reads `GET /api/account/policy` (name,
  team, plan, requirePassword, allowed timed expiries, max reads). No attachments, requests or
  email sending in the extension. The plan only changes which timed lifetimes appear.

## 9. API surface

- **Anonymous notes:** `POST /api/notes`, `POST /api/notes/:id/read`, `DELETE /api/notes/:id`
  (with the delete token).
- **Everything else is in `src/server/router.ts`:**
  - `/api/auth/*`: signup, verify, resend, login, login/code, logout, forgot, reset;
    `GET /api/auth/sso/:provider/start?mode=login|signup|link&next=…&terms=1` and
    `GET /api/auth/sso/:provider/callback` (browser redirects).
  - `/api/account/*`: records (`?kind=&member=`), notes (multipart, or JSON without a file),
    notes/:id/send, requests, team (invite, members, join, name, branding, policy,
    members/:id/shred, audit.csv), `policy` (GET), settings (profile, password, delete, push,
    2fa, api-key, consent, contact), `sso/:provider` (DELETE = disconnect).
  - Public: `/api/requests/:id/respond`, `/api/files/:token` (single-use download grant,
    10 minutes), `/api/notes/:id/events`.
- **Errors** are `{ error: code, message: human text }`. 429 responses include `Retry-After`. The
  browser clients handle 401 by redirecting to `/login`.
- **README "API" section** documents external use. The user compared it with
  https://www.noteshred.com/api (see §12).

## 10. Testing

- `npm test`: 126 unit and integration tests, including race tests for burn-after-read, quotas
  and request responses; policy enforcement; audit log and CSV; shredding a member; SSO with a
  fake provider (CSRF, replay, nonce/aud/iss/exp, unverified email, pre-registration takeover,
  linking, required SSO); extension client and JSON + API key + extension-origin requests.
- `npm run test:e2e`: 23 Playwright tests, including sign-up, 2FA across two browser contexts,
  attachment and request round trips, CSP-clean pages, the admin page and policy, Google
  Analytics opt-in scope, the header extension button, and the **real extension** loaded into
  Chromium (`channel: 'chromium'`, new headless) for quick and account notes.
- The e2e `webServer` command builds the site, **builds the extension against
  `http://127.0.0.1:8788`**, migrates the local D1 and runs `wrangler dev` with
  `DEV_OUTBOX`, a local `APP_URL` and Turnstile's test key. Each test gets a random
  `CF-Connecting-IP` (`tests/e2e/client-ip.ts`) so per-IP rate limits don't trip. Plans are set
  in e2e by running wrangler's JS with Node directly (no shell quoting).
- Lighthouse scores were 100/100/100/100 on the marketing pages at the last check.
- Run `npx tsc --noEmit`, `npm test` and `npm run test:e2e` before committing.

## 11. Traps already hit (save yourself the time)

- **Workers types vs DOM:** in browser scripts, `element.append(...)` fails to type-check
  (HTMLRewriter types). Use `appendChild`, and type DOM roots as `HTMLElement | Document`.
  `HTMLSelectElement` also clashes: use `HTMLElement` + `closest('form')`, or a local
  `type Select = HTMLElement & { value: string }`.
- **D1:** binding parameters the SQL doesn't use can error. Write conditional SQL
  (`?3 IS NULL OR col = ?3`) instead of building the parameter list dynamically.
- **R2 `put()`** rejects streams of unknown length. Pass `await file.arrayBuffer()`.
- **Tailwind 4:** you can't `@apply` a class from `@layer components`. Composable bases (`btn`,
  `notice`, `link`) are `@utility`. The important modifier is a trailing `!` (`mb-0!`).
- **Prose links:** `.prose-page a` excludes `.btn-*` classes. Button-styled links once rendered
  invisible because of this, so keep the exclusion.
- **Dark mode:** use token pairs (e.g. `bg-danger text-danger-ink`). Check WCAG AA contrast in
  both themes.
- **Long labels in two-column rows** wrap and push inputs out of line. Keep labels short (put the
  reason in a hint below) and use `items-end` / `align-items: end` on the row.
- **Windows shell:**
  - PowerShell `Set-Content -Encoding utf8` adds a BOM (it broke `package.json`) and
    `-Encoding ascii` mangles `…`. Prefer the Edit/Write tools, or
    `[IO.File]::WriteAllText(path, text, (New-Object Text.UTF8Encoding $false))`.
  - **Commit messages containing `"` break PowerShell 5.1 argument passing** (git treats the rest
    as pathspecs). Use `git commit -F <file>` or several `-m` without double quotes.
  - `python -` hangs (Windows Store stub). Bash heredocs with quotes are fragile.
  - `npx … --shell` quoting of SQL fails; run `node node_modules/wrangler/bin/wrangler.js …`
    with `execFileSync(process.execPath, …)`.
- **Git push:** the harness sets `GCM_INTERACTIVE=never`. Set `$env:GCM_INTERACTIVE='always'`
  before `git push`/`fetch`. The remote URL includes `mansoor1234@`, so the right saved
  credential is used (another account, `abdulwahid321`, is also saved on this machine).
- **Astro origin check** refuses cross-site *form-type* POSTs (multipart, urlencoded, text/plain).
  JSON passes. That's why the extension sends JSON and `readMultipart` accepts JSON when there's
  no file.
- `build.format: 'file'` makes prerendered pathnames end in `.html`. Use `cleanPath()` for
  canonical URLs and nav state.
- `APP_URL` is used for links in emails and SSO redirect URIs, never the request Host header.
  `wrangler.toml` holds the production value; `.dev.vars` overrides it locally and the e2e server
  overrides it with `--var`. The build-time `site` (canonical, sitemap) defaults to
  `https://vanishnote.net` in `astro.config.mjs`.
- **`[dev] host = "localhost"` must stay in `wrangler.toml`.** Without it, the custom-domain
  `routes` make `wrangler dev` rewrite request URLs to `vanishnote.net`, which silently turns off
  the localhost-only paths (Turnstile bypass, dev outbox) and breaks local sign-up.
- **Stale servers:** Playwright reuses a server already on port 8788 when not in CI. Stop any
  manual `wrangler dev` on 8788 before `npm run test:e2e`, or tests run against old code.
- **Local D1 needs migrations too:** a 500 from a new route locally usually means
  `npm run db:migrate:local` wasn't run (the e2e command runs it; a manual server doesn't).
- **After e2e, `dist-extension/` points at the test server.** Run `npm run build:extension`
  before giving the user the folder or zips.
- **SSO in tests:** `ssoDeps.fetch` (in `sso.ts`) is the injectable token-endpoint fetch.
- `PRIVATE_PATH` drives both the noindex headers and the sitemap filter. Add new private routes there.
- Turnstile's script loads only on pages using `Auth.astro` with `turnstile` set.

## 12. Open items and decisions waiting on the user

- **Production** at https://vanishnote.net on Cloudflare's free plans (Workers, D1
  `vanishnote-db`, R2 `vanishnote-files`, Turnstile) plus Resend. The user wants **no monthly
  bills** (yearly budget ~10,000 PKR). The risk is the Workers Free CPU limit per request (error
  1102); the fallback is a yearly VPS port (a few days' work).
  - Deploy: `npm run db:migrate:remote` (if `migrations/` changed) **then** `npm run deploy`.
    Remote has migrations 0001–0005 applied. Then `git push`.
  - Secrets set: `RESEND_API_KEY`, `TURNSTILE_SECRET_KEY`, `VAPID_PRIVATE_KEY`. Not yet:
    `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_SECRET`.
  - `workers_dev = false`; custom domains `vanishnote.net` and `www.vanishnote.net`.
  - Dashboard-only settings (not in the repo): Single Redirect rules `www` → apex and
    `http` → `https` (both 301, query string preserved); Email Routing forwards `hello@`,
    `security@` (and possibly `notify@`) to the user's Gmail (verified working). Resend's sending
    records live on `send.vanishnote.net` and `resend._domainkey`; don't touch them.
  - Still to do by the user: submit `https://vanishnote.net/sitemap-index.xml` in Google Search
    Console; Google may take days/weeks to show the new favicon.
- **SSO not switched on yet:** the user must create the Google OAuth client and the Microsoft
  Entra app (README "Single sign-on", including the `email` + `xms_edov` optional claims), then
  set `GOOGLE_CLIENT_ID` / `MICROSOFT_CLIENT_ID` in `wrangler.toml` and the two secrets.
- **Extension not published:** the user needs Chrome Web Store (US$5 one-time), Edge Add-ons and
  Firefox Add-ons developer accounts; zips come from `npm run build:extension`. After publishing,
  put the listing URLs in `EXTENSION_STORES` (`src/lib/extension-store.ts`) and deploy: the header
  button and `/extension` then link to the stores instead of "coming soon".
- **Offered, awaiting go-ahead: "Connect to my account" for the extension** (no copying the API
  key; ~1–1.5 days). Plan: `identity.launchWebAuthFlow` (Chrome/Edge/Firefox) opens a
  vanishnote.net consent page ("Allow the Vanishnote extension in Chrome to create notes for
  Jane?"); a one-time state binds the result. Issue **separate per-browser extension tokens**
  (new table, hashed, note endpoints + policy only, listed in Settings → "Connected browsers"
  with last-used and Disconnect, audited) instead of reusing the single personal API key, which
  would silently revoke the user's scripts. No password prompt (session + explicit Allow). Keep
  manual API-key entry as a fallback.
- **Proposed, not approved: extension "paste protection"** (discussed 2026-10-19; confirm scope
  with the user before building, estimate 3–4 days).
  - What: a content script watches message boxes on chat/email sites (Gmail, Outlook, Slack,
    Teams, WhatsApp Web, Discord, Jira, GitHub). When the user types or pastes something that
    looks like a secret, a small Vanishnote icon offers "Send it as a self-destructing link
    instead?"; one click encrypts it and replaces the secret in the message with the link
    (clipboard fallback where rich editors such as Gmail/Slack/Teams resist replacement).
    Possible later: an icon next to password fields.
  - Detect on-device only: AWS/GitHub/Stripe/OpenAI-style keys, private key blocks, JWTs, `.env`
    lines (`DB_PASSWORD=…`), "password: …" text, optionally Luhn-checked card numbers. Keep false
    positives rare; dismiss per message and disable per site.
  - Trust rules: **off by default**; request `optional_host_permissions` for the listed sites when
    the user turns it on (never "all sites" by default: it shows as "read and change all your
    data", undermines a privacy product and slows store review). Nothing leaves the device unless
    the user clicks. Update `src/pages/privacy.astro`, `src/pages/extension.astro` ("What it can
    and can't access"), `SECURITY.md` and the store listings.
  - Alternatives the user may still choose: highlight secrets already visible on a page, or run
    on all sites by default.
- **SEO plan** (agreed 2026-10-24): see `docs/SEO_PLAN.md`. Build items 1–3 done (landing pages,
  comparison pages, password generator); blog posts and languages next. Owner tasks (Search
  Console, Bing, launches, directories) are theirs. Landing pages and the generator hold a note
  form or a password, so they are NOT in `ANALYTICS_PATHS`; the two comparison pages are.
  The comparison tables were written without access to the competitors' sites (blocked from the
  agent sandbox): the owner must check each claim before deploying, and re-check periodically.
- **Ideas offered earlier, not requested:** plan badge / upgrade hint in the extension,
  attachments or requests from the extension, file-only secure links, QR code for links,
  note templates, more languages, CLI/SDK, webhooks.
- **NoteShred API parity gaps (offered, not done):**
  1. a "shred" endpoint that destroys the content but keeps the record (status `destroyed`);
  2. an optional `message` on `/api/account/notes/:id/send`.

  A NoteShred-compatible layer (`/api/v2` paths, `Token token=` header, `{message,result}`
  envelope) was discussed. **Accepting plaintext content and passwords server-side was flagged
  as breaking the core promise. Don't do it without explicit user approval.**
- **Billing (Stripe / Paddle / Lemon Squeezy) is not connected.** Plans are set by SQL. Check
  which provider works with the user's bank in Pakistan before building.
- **Not verified end to end against real services:** Resend delivery (a new user once had to be
  verified manually: check Resend's Emails/Domains pages), Turnstile with real keys, Web Push
  to a real device, and R2/cron in production. Inbound mail to `hello@`/`security@` is verified.
- **Flaky e2e:** a sign-up occasionally fails with "Something went wrong" and passes on re-run;
  cause unknown.
- **The legal pages** (terms, privacy) are sensible drafts, not lawyer-reviewed.

## 13. Local state and user preferences

- **Production accounts the user uses** (plans set by SQL): "Mansoor Bahadur" (Business),
  "Mansoor Khan" (Standard), "Mansoor khan" and "Mansoor" (`mansoor@test.com`, not a real inbox)
  on Free; the last two were email-verified manually. Look them up with
  `npx wrangler d1 execute vanishnote-db --remote --command "SELECT …"`.
- **Local D1** has only test data (it was reset when `database_id` changed). The Cloudflare
  account is mansoorbahadur1234@gmail.com; `wrangler login` is done on this machine.
- **No approval needed for file edits** in this repo; the user said not to ask. Finished features
  have been deployed and pushed as part of the work; still confirm anything destructive
  (deleting data, removing secrets) and anything sent to real people.
- **Commit in logical steps** and end commit messages with the attribution trailer
  (`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`). Push to GitHub after committing.
- **Write user-facing copy** in plain, calm English. Every security claim must be accurate (no
  "unhackable"). If you change what the server or extension sees, update `SECURITY.md`, the
  privacy page and the `/extension` page.
- **Check visuals** with Playwright screenshots (light, dark, mobile) before calling UI done.

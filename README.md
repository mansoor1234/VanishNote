# Vanishnote

End-to-end encrypted notes that self-destruct after they're read. Notes are encrypted in the
browser, the key travels in the URL fragment, and the server only ever stores ciphertext.

- **Quick notes** need no account (home page).
- **Accounts** add a dashboard: notes with encrypted attachments, password hints, "shred after a set
  time", emailing links, activity history, end-to-end encrypted **information requests**, teams,
  company branding, and email + push notifications.
- **Plans:** Free ($0), Standard ($5/user/month) and Business ($30/month flat), defined once in
  [`src/lib/plans.ts`](src/lib/plans.ts) and enforced on the server. Card billing isn't wired up
  yet (see [Changing a team's plan](#changing-a-teams-plan)).

Stack: Astro 7 + `@astrojs/cloudflare` on Cloudflare Workers, D1, R2, Cron Triggers, the Workers
Rate Limiting binding, Cloudflare Turnstile, Tailwind CSS 4, the Web Crypto API, Resend, Vitest
and Playwright.

See [SECURITY.md](SECURITY.md) for the threat model.

## Project layout

```
src/
  lib/          crypto.ts (all client crypto), plans.ts, limits.ts, schema.ts (zod), encoding.ts, site.ts
  server/       api.ts (anonymous notes), router.ts (account API route table), auth.ts, account-notes.ts,
                requests.ts, team.ts, settings.ts, records.ts (activity), usage.ts (quotas),
                webpush.ts (RFC 8291/8292), mail.ts + templates.ts, cleanup.ts (cron), db.ts, http.ts
  pages/        marketing + blog + pricing (prerendered); n/, d/, r/, app/, auth pages, api/** (on demand)
  layouts/      Base (site), App (dashboard), Auth, Prose
  scripts/      browser code: create / reveal / respond / auth / app/* (dashboard)
  worker.ts     Worker entry: Astro fetch handler + cron `scheduled` cleanup
  middleware.ts session guard for /app, security headers for on-demand responses
migrations/     D1 migrations
public/         _headers (static security headers), sw.js (push service worker), icons
tests/          unit/, integration/ (real local D1 + R2), e2e/ (Playwright)
```

## Local setup

Requires Node ≥ 22.12.

```sh
npm install
cp .dev.vars.example .dev.vars        # optional secrets, see Configuration
npm run db:migrate:local              # creates the local D1 schema in .wrangler/state
npm run build
npx wrangler dev --var DEV_OUTBOX:true   # production build on workerd, http://localhost:8787
```

With `DEV_OUTBOX=true`, emails (verification links, invitations, notifications) are written to a
local table instead of being sent. Read them at
`http://localhost:8787/api/dev/outbox?to=you@example.com`. The endpoint returns 404 unless that
var is set **and** the request is to localhost; never set it in production.

Locally, Turnstile uses Cloudflare's always-pass test key, and the server skips verification
for localhost requests when `TURNSTILE_SECRET_KEY` is unset.

`npm run dev` (Astro's dev server) also works for UI work, but the strict CSP is only enforced
by the production build.

## Tests

```sh
npm test                              # Vitest: crypto, web push, accounts, quotas, races, cleanup
npx playwright install chromium       # first time only
npm run test:e2e                      # builds, migrates, runs wrangler dev (with DEV_OUTBOX), runs Playwright
npx tsc --noEmit                      # type check
```

The integration tests use Wrangler's `getPlatformProxy` for real, in-memory D1 and R2 bindings,
so the race tests (concurrent reads, concurrent quota use, concurrent request responses)
exercise the real database engine.

## Configuration

| Name                   | Where                          | Purpose |
| ---------------------- | ------------------------------ | ------- |
| `APP_URL`              | `wrangler.toml` **and** build env | Public origin, `https://vanishnote.net`. Build: canonical URLs, sitemap (defaults to the production domain in `astro.config.mjs`). Runtime: links in emails. Overridden locally in `.dev.vars`. |
| `EMAIL_FROM`           | `wrangler.toml`                | Sender on a domain verified in Resend |
| `RESEND_API_KEY`       | secret                         | Resend API key. Unset: no emails are sent (sign-up can't be verified). |
| `TURNSTILE_SITE_KEY`   | `wrangler.toml`                | Turnstile site key (public). Production key in `wrangler.toml`; Cloudflare's test key in `.dev.vars` locally. |
| `TURNSTILE_SECRET_KEY` | secret                         | Turnstile secret. **Required in production**: without it, sign-up fails closed off localhost. |
| `VAPID_PUBLIC_KEY`     | `wrangler.toml`                | Web Push public key. Empty: push is turned off (email still works). |
| `VAPID_PRIVATE_KEY`    | secret                         | Web Push private key. Generate both with `node scripts/generate-vapid.mjs`. |
| `VAPID_SUBJECT`        | `wrangler.toml`                | `mailto:` contact for push services |
| `GOOGLE_CLIENT_ID`     | `wrangler.toml`                | Google OAuth client ID. Empty: no Google button. See Single sign-on. |
| `GOOGLE_CLIENT_SECRET` | secret                         | Google OAuth client secret |
| `MICROSOFT_CLIENT_ID`  | `wrangler.toml`                | Microsoft Entra application (client) ID. Empty: no Microsoft button. |
| `MICROSOFT_CLIENT_SECRET` | secret                      | Microsoft Entra client secret (expires: set a reminder) |
| `DEV_OUTBOX`           | `--var` locally only           | See Local setup |

Bindings in `wrangler.toml`: `DB` (D1), `FILES` (R2, encrypted attachments and logos),
`CREATE_LIMITER` (10/min), `READ_LIMITER` (30/min), `AUTH_LIMITER` (10/min). Contact addresses on
public pages are in `src/lib/site.ts`. After changing `wrangler.toml`, run `npm run cf-typegen`.

## Deploy

```sh
npx wrangler login
npx wrangler d1 create vanishnote-db     # copy the database_id into wrangler.toml
npx wrangler r2 bucket create vanishnote-files
npm run db:migrate:remote
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put TURNSTILE_SECRET_KEY   # and set TURNSTILE_SITE_KEY in wrangler.toml
node scripts/generate-vapid.mjs                # put the public key in wrangler.toml, then:
npx wrangler secret put VAPID_PRIVATE_KEY
# set APP_URL, EMAIL_FROM, VAPID_SUBJECT in wrangler.toml (and the site default in
# astro.config.mjs if the domain changes), then:
npm run deploy
```

**Always run `npm run db:migrate:remote` before `npm run deploy`** when `migrations/` has new
files: the new code reads the new columns, and every signed-in page fails until they exist.

The hourly cron expires notes and requests, enforces each plan's retention on history, clears
expired sessions and tokens, and deletes R2 files nothing can reach any more.

## Browser extension

`extension/` is a Manifest V3 extension for Chrome, Edge and Firefox: a toolbar popup and a
right-click "Send as a self-destructing Vanishnote" for selected text. Notes are encrypted in the
extension with `src/lib/crypto.ts`. Without an API key it sends quick notes (like the home page);
with one (Settings → Your API key, pasted in the extension's settings) notes go to the dashboard
and team policies apply. Permissions: `contextMenus`, `storage`, and the Vanishnote site only.

```sh
npm run build:extension      # dist-extension/chrome, dist-extension/firefox, and store zips
node scripts/build-extension.mjs --server http://localhost:8787   # for local testing (no zips)
```

- **Try it:** Chrome/Edge → `chrome://extensions` → Developer mode → **Load unpacked** →
  `dist-extension/chrome`. Firefox → `about:debugging` → This Firefox → **Load Temporary Add-on**
  → `dist-extension/firefox/manifest.json`.
- **Publish:** upload `vanishnote-chrome-<version>.zip` to the
  [Chrome Web Store](https://chrome.google.com/webstore/devconsole) (one-time US$5 developer fee)
  and the [Edge Add-ons](https://partner.microsoft.com/dashboard/microsoftedge) dashboard (free),
  and `vanishnote-firefox-<version>.zip` to [addons.mozilla.org](https://addons.mozilla.org/developers/)
  (free). Store listings ask for a privacy policy URL: use `https://vanishnote.net/privacy`.
- **New version:** bump `extension/version.json`, rebuild, upload. Icons come from
  `node scripts/generate-og.mjs`; the popup screenshots on `/extension` from
  `node scripts/screenshot-extension.mjs` (after a production build).
- **After publishing:** paste each listing URL into `EXTENSION_STORES` in
  `src/lib/extension-store.ts` and deploy. The header's "Add to Chrome / Edge / Firefox" button
  then opens that store directly (sites can't install extensions themselves); until then it
  links to `/extension`, which shows "coming soon".

## Single sign-on (Google and Microsoft)

Each button appears once its client ID and secret are set. Redirect URIs are
`https://vanishnote.net/api/auth/sso/google/callback` and
`https://vanishnote.net/api/auth/sso/microsoft/callback` (add the `http://localhost:8787/…`
versions too for local testing).

**Google** ([console.cloud.google.com](https://console.cloud.google.com)):

1. Create a project → **APIs & Services → OAuth consent screen**: External, app name
   "Vanishnote", support email, logo, links to `/privacy` and `/terms`. Scopes: `openid`, `email`,
   `profile` (no verification review is needed for these). Publish the app.
2. **Credentials → Create credentials → OAuth client ID → Web application**. Authorized redirect
   URI: the Google one above.
3. Put the client ID in `wrangler.toml` (`GOOGLE_CLIENT_ID`) and run
   `npx wrangler secret put GOOGLE_CLIENT_SECRET`.

**Microsoft** ([entra.microsoft.com](https://entra.microsoft.com) → App registrations → New):

1. Supported account types: **Accounts in any organizational directory and personal Microsoft
   accounts**. Redirect URI (Web): the Microsoft one above.
2. **Token configuration → Add optional claim → ID → `email` and `xms_edov`**. Without
   `xms_edov`, work accounts can't be matched to an existing account by email (users can still
   connect Microsoft from Settings while signed in, or sign up with it).
3. **Certificates & secrets → New client secret**. Copy the *value* and run
   `npx wrangler secret put MICROSOFT_CLIENT_SECRET`. Secrets expire (up to 24 months): set a
   reminder to rotate it.
4. Put the **Application (client) ID** in `wrangler.toml` (`MICROSOFT_CLIENT_ID`).

Regenerate the social images and push icon after branding changes with
`node scripts/generate-og.mjs`.

## API

Create a personal key in **Settings → Your API key** (it's shown once; we store only its hash)
and send it as `Authorization: Bearer vn_…`. Keys work on these endpoints only, never on account
or security settings:

| Method | Path | |
| ------ | ---- | - |
| `GET` | `/api/account/policy` | The team's rules for new notes: `requirePassword`, allowed `timedExpiry`, `maxLifetimeDays` |
| `GET` | `/api/account/records?kind=note\|request&member=:userId` | Notes and requests, with status (`member` on shared plans) |
| `GET` | `/api/account/records/:id` | One record and its activity history |
| `DELETE` | `/api/account/records/:id` | Destroy a note / cancel a request, and delete its history |
| `POST` | `/api/account/notes` | Create a note (`multipart/form-data`: `meta` JSON + optional encrypted `file`) |
| `POST` | `/api/account/notes/:id/send` | Email the link to a recipient (password-protected notes only) |
| `POST` | `/api/account/requests` | Create an information request |
| `GET` | `/api/account/requests/:id/key` | The request's wrapped private key (no side effects) |
| `POST` | `/api/account/requests/:id/open` | Fetch and shred an answered request |

Everything is end-to-end encrypted, so **your code encrypts before calling the API**, exactly as
the browser does. Reuse [`src/lib/crypto.ts`](src/lib/crypto.ts) (`sealNote`, `createRequestKeys`,
`unlockRequestKey`, …); it only needs Web Crypto, so it runs unchanged in Node 22, Deno, Bun and
Workers. The `meta` JSON for a note is validated by `accountNoteSchema` in
[`src/server/account-notes.ts`](src/server/account-notes.ts). Build the share link as
`APP_URL + path + "#" + linkKey` from the `path` the API returns. Rate limits apply per IP.

```sh
curl https://your-domain/api/account/records -H "Authorization: Bearer vn_…"
```

## Changing a team's plan

Billing isn't connected yet. Upgrade requests arrive through the dashboard's Contact form
(subject "Upgrade to …"). Apply them with SQL:

```sh
npx wrangler d1 execute vanishnote-db --remote --command \
  "UPDATE teams SET plan = 'standard', seats = 5 WHERE id = (SELECT team_id FROM users WHERE email = 'owner@company.com')"
```

`plan` is `free`, `standard` or `business`; `seats` only matters for Standard. Limits take effect
on the next request. Hooking up Stripe later means setting the same two columns from a webhook.

## Notes on the spec

- **"Hybrid" rendering.** Astro removed `output: 'hybrid'` in v5. The equivalent is
  `output: 'static'` with `export const prerender = false` on dynamic routes.
- **Multi-read consumption.** The final read takes the `DELETE … RETURNING` branch directly, in
  the same D1 batch (transaction) as the decrement branch, so a row never sits at `reads_left = 0`.
- **Wrong passwords.** The server can't check note passwords, so revealing a password-protected
  note consumes it first; the ciphertext stays in the tab and can be retried. Information
  requests do better: the request password is checked locally *before* the response is fetched.
- **CSP as a header.** No inline scripts or styles anywhere; Turnstile's origin is allowed only on
  `/signup`, `/forgot` and `/verify`.
- **Logging.** Workers observability is disabled because invocation logs record request URLs,
  which contain note IDs.
- **Quick notes vs plans.** Notes from the home page need no account and have no monthly quota
  (only the per-IP rate limit). Their longest lifetime equals the Free plan's retention (7 days),
  so signing up never means shorter-lived notes; a unit test keeps the two in step. Accounts add
  attachments, the dashboard, activity history, requests and longer retention on paid plans.

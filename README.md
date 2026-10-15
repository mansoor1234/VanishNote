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
| `APP_URL`              | `wrangler.toml` **and** build env | Public origin, e.g. `https://vanishnote.app`. Build: canonical URLs, sitemap. Runtime: links in emails. |
| `EMAIL_FROM`           | `wrangler.toml`                | Sender on a domain verified in Resend |
| `RESEND_API_KEY`       | secret                         | Resend API key. Unset: no emails are sent (sign-up can't be verified). |
| `TURNSTILE_SITE_KEY`   | `wrangler.toml`                | Turnstile site key (public). Ships with Cloudflare's test key. |
| `TURNSTILE_SECRET_KEY` | secret                         | Turnstile secret. **Required in production**: without it, sign-up fails closed off localhost. |
| `VAPID_PUBLIC_KEY`     | `wrangler.toml`                | Web Push public key. Empty: push is turned off (email still works). |
| `VAPID_PRIVATE_KEY`    | secret                         | Web Push private key. Generate both with `node scripts/generate-vapid.mjs`. |
| `VAPID_SUBJECT`        | `wrangler.toml`                | `mailto:` contact for push services |
| `DEV_OUTBOX`           | `--var` locally only           | See Local setup |

Bindings in `wrangler.toml`: `DB` (D1), `FILES` (R2, encrypted attachments and logos),
`CREATE_LIMITER` (10/min), `READ_LIMITER` (30/min), `AUTH_LIMITER` (10/min). Contact addresses on
public pages are in `src/lib/site.ts`. After changing `wrangler.toml`, run `npm run cf-typegen`.

## Deploy

```sh
npx wrangler login
npx wrangler d1 create vanishnote-db  # copy the database_id into wrangler.toml
npx wrangler r2 bucket create vanishnote-files
npm run db:migrate:remote
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put TURNSTILE_SECRET_KEY   # and set TURNSTILE_SITE_KEY in wrangler.toml
node scripts/generate-vapid.mjs                # put the public key in wrangler.toml, then:
npx wrangler secret put VAPID_PRIVATE_KEY
# set APP_URL, EMAIL_FROM, VAPID_SUBJECT in wrangler.toml, then:
APP_URL=https://your-domain npm run deploy
```

The hourly cron expires notes and requests, enforces each plan's retention on history, clears
expired sessions and tokens, and deletes R2 files nothing can reach any more.

Regenerate the social images and push icon after branding changes with
`node scripts/generate-og.mjs`.

## API

Create a personal key in **Settings → Your API key** (it's shown once; we store only its hash)
and send it as `Authorization: Bearer vn_…`. Keys work on these endpoints only, never on account
or security settings:

| Method | Path | |
| ------ | ---- | - |
| `GET` | `/api/account/records?kind=note\|request` | Notes and requests, with status |
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
npx wrangler d1 execute vanishnote --remote --command \
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

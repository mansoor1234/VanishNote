# Vanishnote

End-to-end encrypted notes that self-destruct after they're read. Notes are encrypted in the
browser, the key travels in the URL fragment, and the server only ever stores ciphertext.

Stack: Astro 7 + `@astrojs/cloudflare` on Cloudflare Workers, D1, Cron Triggers, the Workers
Rate Limiting binding, Tailwind CSS 4, the Web Crypto API, Resend, Vitest and Playwright.

See [SECURITY.md](SECURITY.md) for the threat model.

## Project layout

```
src/
  lib/          crypto.ts (client crypto), encoding.ts, limits.ts, schema.ts (zod), site.ts
  server/       api.ts (framework-agnostic handlers), db.ts (D1 SQL), http.ts (headers/helpers),
                email.ts (Resend), deps.ts (binds real env)
  pages/        static marketing pages + blog (prerendered); n/[id], d/[id], api/** (on demand)
  scripts/      browser code for create / reveal / destroy
  worker.ts     Worker entry: Astro fetch handler + cron `scheduled` purge
  middleware.ts security headers for on-demand responses
migrations/     D1 migrations
public/_headers security headers for static pages
tests/          unit/ (crypto, headers, email), integration/ (API + D1 race tests), e2e/ (Playwright)
```

## Local setup

Requires Node ≥ 22.12.

```sh
npm install
cp .dev.vars.example .dev.vars        # optional: add RESEND_API_KEY to test emails
npm run db:migrate:local              # creates the local D1 schema in .wrangler/state
npm run dev                           # Astro dev server on http://localhost:4321
```

To run the production build on workerd (the same runtime as production):

```sh
npm run build
npm run preview                       # wrangler dev on http://localhost:8787
```

The strict CSP is only enforced by the production build. Astro's dev server injects inline
scripts.

## Tests

```sh
npm test                              # Vitest: crypto, validation, D1 race/expiry tests
npx playwright install chromium       # first time only
npm run test:e2e                      # builds, migrates local D1, runs wrangler dev, runs Playwright
npm run check                         # astro check + tsc
```

The integration tests use Wrangler's `getPlatformProxy` to get a real, in-memory D1 (SQLite in
workerd), so the concurrent-read tests exercise the real database engine.

## Configuration

| Name             | Where                       | Purpose                                                       |
| ---------------- | --------------------------- | ------------------------------------------------------------- |
| `APP_URL`        | `wrangler.toml` `[vars]` **and** build environment | Public origin, e.g. `https://vanishnote.app`. At build time it sets canonical URLs, the sitemap and robots.txt. At runtime it's the link in notification emails. |
| `EMAIL_FROM`     | `wrangler.toml` `[vars]`    | Sender address on a domain verified in Resend                 |
| `RESEND_API_KEY` | secret (`.dev.vars` locally) | Resend API key. If unset, read notifications are skipped.    |

Rate limits are set in `wrangler.toml` (`CREATE_LIMITER` 10/min, `READ_LIMITER` 30/min per IP).
Contact addresses shown on public pages are in `src/lib/site.ts`.

After changing `wrangler.toml`, run `npm run cf-typegen` to regenerate `worker-configuration.d.ts`.

## Deploy

```sh
npx wrangler login
npx wrangler d1 create vanishnote     # copy the database_id into wrangler.toml
npm run db:migrate:remote
npx wrangler secret put RESEND_API_KEY
# set APP_URL and EMAIL_FROM in wrangler.toml, then:
APP_URL=https://your-domain npm run deploy
```

`npm run deploy` runs `astro build` and `wrangler deploy`. The cron trigger (`0 * * * *`) and
the rate limiters are created from `wrangler.toml`. Attach your custom domain in the Cloudflare
dashboard, or add a `routes` entry.

Regenerate the social image after branding changes with `node scripts/generate-og.mjs`.

## Notes on the spec

- **"Hybrid" rendering.** Astro removed `output: 'hybrid'` in v5. The equivalent is
  `output: 'static'` (prerender by default) with `export const prerender = false` on the note
  pages and API routes, which is what this project uses.
- **Multi-read consumption.** Instead of decrementing to 0 and then deleting, the final read
  takes the `DELETE … RETURNING` branch directly. Both statements run in one D1 batch
  (transaction), so a row never sits at `reads_left = 0`.
- **Wrong passwords.** The server can't check passwords, so revealing a password-protected
  note consumes it first. The ciphertext then stays in the tab's memory and the recipient can
  retry the password as often as needed. Closing the tab before unlocking loses the note.
- **CSP as a header.** Astro's built-in CSP emits a `<meta>` tag, which can't express
  `frame-ancestors`. This app ships no inline scripts or styles, so a static header CSP is
  enough (Markdown syntax highlighting is off because Shiki emits inline styles).
- **Logging.** Workers observability is disabled because invocation logs record request
  URLs, which contain note IDs.

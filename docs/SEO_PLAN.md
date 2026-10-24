# Vanishnote — SEO plan

Agreed plan for search ranking, saved 2026-10-24. Nobody can guarantee the top spot, and a
brand-new domain usually takes 3–6 months to rank for anything competitive.

## Already done (technical)

- Sitemap (`/sitemap-index.xml`), canonical URLs on every page, JSON-LD structured data.
- Fast pages (Lighthouse 100).
- Private pages kept out of search (`PRIVATE_PATH` in `src/lib/private-paths.ts`).

What's left: telling search engines the site exists, pages that match what people search for,
and links from other sites.

## 1. Get indexed (owner, ~30 minutes)

- **Google Search Console:** add `vanishnote.net`, submit `https://vanishnote.net/sitemap-index.xml`,
  then URL Inspection → Request indexing for `/`, `/pricing`, `/security`, `/extension` and the blog posts.
- **Bing Webmaster Tools:** "Import from Google Search Console". Bing also feeds DuckDuckGo,
  Yahoo and ChatGPT search.
- **Google Business Profile:** skip (not a local business).

## 2. Target the right searches

Don't aim for "privnote" first; that brand owns its name. Aim for what people type when they have the problem.

| Search phrase | Page that should rank |
|---|---|
| send password securely, share password safely | dedicated landing page |
| self-destructing note / message | home page (already targeted) |
| one-time secret link, share secret link | landing page |
| privnote alternative, onetimesecret alternative | honest comparison pages |
| share .env / API key securely | developer page |
| encrypted note with expiry, burn after reading | home page and a blog post |
| strong password generator | free tool page (links into sending it as a note) |

Each page needs a clear title, a real answer, a short FAQ and links to the other pages. Thin
"SEO pages" don't rank; useful ones do.

## 3. Publish regularly

1–2 blog posts a month answering real questions, e.g.:

- How to send a password to a client
- Is it safe to send passwords over WhatsApp or Slack?
- What happens to deleted messages in Slack?
- How to share Wi-Fi details with guests

There are 2 posts now; 10–20 good ones make a real difference over 6 months.

## 4. Links from trusted sites (the biggest factor)

- **Launches:** Product Hunt, Hacker News "Show HN" (lead with the security model), relevant
  subreddits (r/privacy, r/sysadmin, r/selfhosted) — only where self-promotion is allowed; answer every question.
- **Directories:** AlternativeTo (as an alternative to Privnote and One-Time Secret), SaaSHub,
  Slant, G2 and Capterra (free), privacy-tool lists such as "awesome-privacy" on GitHub.
- **Extension stores:** a Chrome Web Store listing brings traffic and a strong link.
- **Open-source the crypto module** (`src/lib/crypto.ts`) on GitHub with a short write-up.
- **Never buy links.** Google penalises it.

## 5. Measure monthly

Search Console → Performance: find phrases on page 2 (positions 11–20) and improve those pages first.

## Build work (agent can do)

1. Landing pages: "send password securely", "one-time secret link", "share API keys / .env".
2. Honest comparison pages: "Vanishnote vs Privnote", "vs One-Time Secret" (factual feature tables, verified against their current sites).
3. Free password generator page (generation in the browser via `crypto.ts`), leading into sending it as a note.
4. More blog posts, to the list above.
5. Later: Urdu and other languages.

**Status (2026-10-24): 1–3 built** on branch `claude/landing-pages-password-gen-elge8w`:

| Page | Analytics |
|---|---|
| `/send-password-securely`, `/one-time-secret-link`, `/share-api-keys` (note form on the page) | never |
| `/password-generator` (note form, password made with `generateFromOptions` in `src/lib/password.ts`) | never |
| `/privnote-alternative`, `/onetimesecret-alternative` (no form) | opt-in, like other info pages |

All are in the sitemap, linked from the footer and from each other (`src/lib/guides.ts`). Add new
SEO pages to `GUIDES` so they join the cross-links.

**Comparison rows:** the owner checked every row about Privnote and One-Time Secret on 2026-10-24
(the agent couldn't reach their sites). Re-check every few months and update `AS_OF` in each page.

Next: 4 (blog posts), then 5.

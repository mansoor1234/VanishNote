# Blog publication schedule

Seven posts are scheduled for **09:00 Asia/Karachi (04:00 UTC)** daily, November 15–21, 2026.

| Date | Post |
|---|---|
| November 15 | Password manager or one-time link: which should you use? |
| November 16 | Accidentally shared an API key? What to do next |
| November 17 | How to share your Wi-Fi password with guests |
| November 18 | How to send a .env file to another developer safely |
| November 19 | Why a one-time note says it is unavailable |
| November 20 | How to share credentials with a contractor |
| November 21 | How to clean up passwords left in old messages |

The Markdown and preview images are deployed ahead of time. Cloudflare renders `/blog` and
`/blog/:slug` on request. `src/lib/blog.ts` compares the front matter's `published` timestamp
with the server clock. Before publication, direct article requests return 404 with `noindex`
and `no-store`; the blog list, its JSON-LD, and article recommendations exclude future posts.
There is no cron job, daily upload, external scheduler, or further deployment required for
these seven releases. This uses the existing Cloudflare Worker; normal request limits apply.

`/sitemap-blog.xml` uses the same publication check and is linked from the existing sitemap
index. Static guide pages keep the latest-post recommendations from their most recent build;
they exclude future posts, while the blog itself updates on schedule.

To add another scheduled post, use an explicit timestamp, for example
`published: 2026-11-22T09:00:00+05:00`, generate its card with `node scripts/generate-og.mjs`,
and deploy once. To reschedule an unpublished post, change that timestamp and redeploy.
Preview images are public assets; scheduling controls the article content and discovery,
not confidentiality of the image or title. Do not place private information in blog drafts.

Do not change the publication clock or add a public preview bypass to test future articles.
Unit tests exercise the exact release boundary and the seven-day sequence with explicit times.

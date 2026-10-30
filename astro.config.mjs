// @ts-check
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import cloudflare from '@astrojs/cloudflare';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';
import { PRIVATE_PATH } from './src/lib/private-paths.ts';

// Canonical origin for SEO tags, sitemap and robots.txt. Baked in at build time, so it defaults
// to the production domain; set APP_URL in the build env to build for another origin.
const site = process.env.APP_URL || 'https://vanishnote.net';

/**
 * Sitemap <lastmod>: when the page's source last changed in git (blog posts: their Markdown).
 * Accurate dates help search engines recrawl what changed; a build date on every page would be
 * ignored. Pages without git history get no lastmod rather than a made-up one.
 * @param {string} pathname
 */
function lastModified(pathname) {
  const clean = pathname.replace(/\/$/, '') || '/';
  const file = clean.startsWith('/blog/')
    ? `src/content/blog/${clean.slice('/blog/'.length)}.md`
    : clean === '/'
      ? 'src/pages/index.astro'
      : existsSync(`src/pages${clean}.astro`)
        ? `src/pages${clean}.astro`
        : `src/pages${clean}/index.astro`;
  if (!existsSync(file)) return undefined;
  try {
    const iso = execFileSync('git', ['log', '-1', '--format=%cI', '--', file], { encoding: 'utf8' }).trim();
    return iso || undefined;
  } catch {
    return undefined;
  }
}

// Pages are prerendered by default (static marketing/SEO pages). Note pages and the API opt
// out with `export const prerender = false` and run on the Worker. This is Astro's
// successor to the old `output: 'hybrid'` mode.
export default defineConfig({
  site,
  output: 'static',
  trailingSlash: 'never',
  build: {
    format: 'file',
    // Strict CSP (style-src 'self'): never inline CSS.
    inlineStylesheets: 'never',
  },
  adapter: cloudflare({ imageService: 'passthrough' }),
  session: false,
  // Shiki emits inline style attributes, which our CSP (style-src 'self') blocks.
  markdown: { syntaxHighlight: false },
  integrations: [
    // Only indexable pages: listing a noindex page in the sitemap is a conflict search engines flag.
    sitemap({
      filter: (page) => !PRIVATE_PATH.test(new URL(page).pathname),
      serialize: (item) => {
        const lastmod = lastModified(new URL(item.url).pathname);
        return lastmod ? { ...item, lastmod } : item;
      },
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
    // Strict CSP (script-src 'self'): never inline scripts or assets as data: URIs.
    build: { assetsInlineLimit: 0 },
  },
});

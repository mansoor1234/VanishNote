// @ts-check
import cloudflare from '@astrojs/cloudflare';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';
import { PRIVATE_PATH } from './src/lib/private-paths.ts';

// Canonical origin for SEO tags, sitemap and robots.txt. Baked in at build time, so it defaults
// to the production domain; set APP_URL in the build env to build for another origin.
const site = process.env.APP_URL || 'https://vanishnote.net';

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
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
    // Strict CSP (script-src 'self'): never inline scripts or assets as data: URIs.
    build: { assetsInlineLimit: 0 },
  },
});

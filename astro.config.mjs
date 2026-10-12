// @ts-check
import cloudflare from '@astrojs/cloudflare';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

// Canonical origin for SEO tags, sitemap and robots.txt. Set APP_URL when building for production.
const site = process.env.APP_URL || 'https://vanishnote.example';

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
    sitemap({
      filter: (page) => !/\/(n|d|api)(\/|$)/.test(new URL(page).pathname),
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
    // Strict CSP (script-src 'self'): never inline scripts or assets as data: URIs.
    build: { assetsInlineLimit: 0 },
  },
});

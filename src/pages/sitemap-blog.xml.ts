import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { isPublished } from '../lib/blog';

export const prerender = false;
const escapeXml = (text: string) => text.replace(/[<>&"']/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char]!);

export const GET: APIRoute = async ({ site }) => {
  const now = Date.now();
  const posts = (await getCollection('blog')).filter((post) => isPublished(post, now));
  const urls = posts.map((post) => {
    const url = new URL(`/blog/${post.id}`, site ?? 'https://vanishnote.net').href;
    return `<url><loc>${escapeXml(url)}</loc><lastmod>${(post.data.updated ?? post.data.published).toISOString()}</lastmod></url>`;
  }).join('');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'no-store' },
  });
};

import { readFileSync, readdirSync } from 'node:fs';
import { test, expect } from '@playwright/test';

test('blog routes and sitemap expose only published content', async ({ page, request }) => {
  const files = readdirSync('src/content/blog').filter((file) => file.endsWith('.md'));
  const now = Date.now();
  const posts = files.map((file) => {
    const markdown = readFileSync(`src/content/blog/${file}`, 'utf8');
    const date = markdown.match(/^published:\s*(.+)$/m)![1]!;
    return { slug: file.replace(/\.md$/, ''), published: Date.parse(date) <= now };
  });
  await page.goto('/blog');
  await expect(page.getByRole('heading', { name: 'Blog', exact: true })).toBeVisible();
  await expect(page.locator('a[href="/blog/how-to-send-a-password-to-a-client"]')).toBeVisible();
  const listing = await page.content();
  const sitemap = await request.get('/sitemap-blog.xml');
  expect(sitemap.status()).toBe(200);
  expect(sitemap.headers()['content-type']).toContain('application/xml');
  expect(sitemap.headers()['cache-control']).toBe('no-store');
  const xml = await sitemap.text();
  expect(await (await request.get('/sitemap-index.xml')).text()).toContain('/sitemap-blog.xml');

  for (const post of posts) {
    const path = `/blog/${post.slug}`;
    const response = await request.get(path);
    expect(response.status(), path).toBe(post.published ? 200 : 404);
    expect(response.headers()['cache-control'], path).toBe('no-store');
    if (post.published) {
      expect(listing).toContain(path);
      expect(xml).toContain(path);
      expect(await response.text()).toContain('BlogPosting');
      expect(response.headers()['content-security-policy']).toContain('googletagmanager');
    } else {
      expect(listing).not.toContain(path);
      expect(xml).not.toContain(path);
      expect(response.headers()['x-robots-tag']).toBe('noindex');
      expect(await response.text()).toBe('Not found');
    }
  }

  await page.goto('/blog/how-to-send-a-password-to-a-client');
  for (const post of posts.filter((post) => !post.published)) {
    await expect(page.locator(`a[href="/blog/${post.slug}"]`)).toHaveCount(0);
  }
  expect((await request.get('/blog/unknown-post')).status()).toBe(404);
});

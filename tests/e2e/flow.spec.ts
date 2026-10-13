import { expect, test, type Page } from '@playwright/test';
import { useFreshClientIp } from './client-ip';

const GONE = 'This note is gone';
const GENERIC_404 = "This note doesn't exist or has already been read.";

// The app guards against losing a link or note with beforeunload/confirm prompts.
// Accept them by default so navigation in tests proceeds; tests that check a guard override this.
test.beforeEach(async ({ page, context }) => {
  await useFreshClientIp(context);
  page.on('dialog', (dialog) => void dialog.accept().catch(() => {}));
});

/**
 * Collect console errors, which include CSP violations. Chrome also logs every non-2xx fetch,
 * so the API's deliberate 404 for a consumed note is ignored.
 */
function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    if (/status of 404/.test(msg.text()) && /\/api\/notes\/.+\/read$/.test(msg.location().url)) return;
    errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

async function createNote(
  page: Page,
  text: string,
  options: { password?: string; maxReads?: string; expiresIn?: string } = {},
) {
  await page.goto('/');
  await page.getByLabel('Your note').fill(text);
  if (options.expiresIn) await page.getByLabel('Delete if unread after').selectOption(options.expiresIn);
  if (options.maxReads) await page.getByLabel('Destroy after').selectOption(options.maxReads);
  if (options.password) await page.getByLabel(/^Password/).fill(options.password);
  await page.getByRole('button', { name: 'Create secure link' }).click();
  await expect(page.getByRole('heading', { name: 'Your link is ready' })).toBeVisible({ timeout: 15_000 });
  const link = await page.getByLabel('Share this link').inputValue();
  const destroyLink = await page.getByLabel('Destroy link').inputValue();
  return { link, destroyLink };
}

test('create → open link → reveal → destroyed on reload', async ({ page }) => {
  const errors = trackConsoleErrors(page);
  const secret = `launch code ${Date.now()}\nline two`;
  const { link } = await createNote(page, secret);

  expect(link).toMatch(/\/n\/[A-Za-z0-9_-]{22}#[A-Za-z0-9_-]{43}$/);
  // The form no longer holds the plaintext.
  expect(await page.getByLabel('Your note').inputValue()).toBe('');

  await page.goto(link);
  await expect(page.getByRole('heading', { name: "You've received a private note" })).toBeVisible();
  await page.getByRole('button', { name: 'Open and read note' }).click();
  await expect(page.getByRole('heading', { name: "Here's your note" })).toBeVisible();
  await expect(page.locator('#note-content')).toHaveText(secret);
  await expect(page.getByText('This note has now been destroyed')).toBeVisible();

  await page.getByRole('button', { name: 'Copy note' }).click();
  // Windows converts \n to \r\n on the system clipboard.
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied.replace(/\r\n/g, '\n')).toBe(secret);

  await page.reload();
  await page.getByRole('button', { name: 'Open and read note' }).click();
  await expect(page.getByRole('heading', { name: GONE })).toBeVisible();
  await expect(page.getByText(GENERIC_404)).toBeVisible();

  expect(errors).toEqual([]);
});

test('an uncopied link is protected from "Write another note" until it is copied', async ({ page }) => {
  await createNote(page, 'do not lose me');
  page.removeAllListeners('dialog');

  // Dismissing the confirm keeps the one-time link on screen.
  let prompt = '';
  page.once('dialog', (dialog) => {
    prompt = dialog.message();
    void dialog.dismiss();
  });
  await page.getByRole('button', { name: 'Write another note' }).click();
  expect(prompt).toContain("haven't copied the link");
  await expect(page.getByLabel('Share this link')).not.toHaveValue('');

  // Once copied, there's no prompt.
  await page.getByRole('button', { name: 'Copy link' }).click();
  page.once('dialog', () => {
    throw new Error('unexpected dialog after copying');
  });
  await page.getByRole('button', { name: 'Write another note' }).click();
  await expect(page.getByLabel('Your note')).toBeVisible();
});

test('note pages show a generic social card and no live region around the note', async ({ request, page }) => {
  const html = await (await request.get('/n/AAAAAAAAAAAAAAAAAAAAAA')).text();
  expect(html).toMatch(/<meta property="og:image" content="[^"]+\/og-note\.png"/);
  expect(html).not.toContain('og:url');
  await page.goto('/n/AAAAAAAAAAAAAAAAAAAAAA#x');
  await expect(page.locator('#reveal')).not.toHaveAttribute('aria-live');
});

test('opening the link (like a chat preview bot) does not consume the note', async ({ page, request }) => {
  const { link } = await createNote(page, 'preview-safe');
  const url = new URL(link);
  for (let i = 0; i < 3; i++) {
    const res = await request.get(url.pathname, { headers: { 'User-Agent': 'WhatsApp/2.23 Slackbot-LinkExpanding' } });
    expect(res.status()).toBe(200);
    expect(res.headers()['cache-control']).toContain('no-store');
    expect(res.headers()['x-robots-tag']).toContain('noindex');
    expect(await res.text()).not.toContain('preview-safe');
  }
  await page.goto(link);
  await page.getByRole('button', { name: 'Open and read note' }).click();
  await expect(page.locator('#note-content')).toHaveText('preview-safe');
});

test('password-protected note survives a wrong guess and unlocks with the right password', async ({ page }) => {
  const { link } = await createNote(page, 'behind two locks', { password: 'tr0ub4dor&3' });
  await expect(page.getByText('different channel')).toBeVisible();

  await page.goto(link);
  await page.getByRole('button', { name: 'Open and read note' }).click();
  await expect(page.getByRole('heading', { name: 'This note is password-protected' })).toBeVisible();

  await page.getByLabel('Password').fill('wrong');
  await page.getByRole('button', { name: 'Unlock note' }).click();
  await expect(page.getByRole('alert')).toContainText("didn't work");

  await page.getByLabel('Password').fill('tr0ub4dor&3');
  await page.getByRole('button', { name: 'Unlock note' }).click();
  await expect(page.locator('#note-content')).toHaveText('behind two locks');
});

test('multi-view note counts down and then disappears', async ({ page }) => {
  const { link } = await createNote(page, 'seen twice', { maxReads: '2' });
  await page.goto(link);
  await page.getByRole('button', { name: 'Open and read note' }).click();
  await expect(page.getByText('can be opened 1 more time')).toBeVisible();
  await page.goto('about:blank');
  await page.goto(link);
  await page.getByRole('button', { name: 'Open and read note' }).click();
  await expect(page.getByText('This note has now been destroyed')).toBeVisible();
  await page.goto('about:blank');
  await page.goto(link);
  await page.getByRole('button', { name: 'Open and read note' }).click();
  await expect(page.getByRole('heading', { name: GONE })).toBeVisible();
});

test('a link without its key does not burn the note', async ({ page }) => {
  const { link } = await createNote(page, 'keep me');
  await page.goto(link.split('#')[0]!);
  await expect(page.getByRole('heading', { name: 'This link is incomplete' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open and read note' })).toBeHidden();
  await page.goto('about:blank');
  await page.goto(link);
  await page.getByRole('button', { name: 'Open and read note' }).click();
  await expect(page.locator('#note-content')).toHaveText('keep me');
});

test('HTML in a note is shown as text, never executed', async ({ page }) => {
  const payload = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script><b>bold?</b>';
  const { link } = await createNote(page, payload);
  await page.goto(link);
  await page.getByRole('button', { name: 'Open and read note' }).click();
  await expect(page.locator('#note-content')).toHaveText(payload);
  expect(await page.locator('#note-content img, #note-content script, #note-content b').count()).toBe(0);
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
});

test('the creator can destroy a note early with the destroy link', async ({ page }) => {
  const { link, destroyLink } = await createNote(page, 'never mind');
  expect(destroyLink).toMatch(/\/d\/[A-Za-z0-9_-]{22}#[A-Za-z0-9_-]{43}$/);
  await page.goto(destroyLink);
  await page.getByRole('button', { name: 'Destroy note now' }).click();
  await expect(page.getByRole('heading', { name: 'The note has been destroyed' })).toBeVisible();

  await page.goto(link);
  await page.getByRole('button', { name: 'Open and read note' }).click();
  await expect(page.getByRole('heading', { name: GONE })).toBeVisible();
});

test('marketing pages are indexable; note pages are not', async ({ page, request }) => {
  const errors = trackConsoleErrors(page);
  for (const path of ['/', '/how-it-works', '/security', '/faq', '/privacy', '/terms', '/blog']) {
    await page.goto(path);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index, follow');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', new RegExp(`${path === '/' ? '/' : path}$`));
    await expect(page.locator('h1')).toHaveCount(1);
  }
  await page.goto('/n/AAAAAAAAAAAAAAAAAAAAAA#x');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);

  const sitemap = await (await request.get('/sitemap-0.xml')).text();
  expect(sitemap).toContain('/faq');
  expect(sitemap).not.toMatch(/\/(n|d)\//);
  expect(errors).toEqual([]);
});

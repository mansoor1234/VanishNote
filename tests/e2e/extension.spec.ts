import { resolve } from 'node:path';
import { chromium, expect, test, type BrowserContext } from '@playwright/test';
import { deriveAuthKey } from '../../src/lib/crypto';
import { useFreshClientIp } from './client-ip';

/**
 * The real extension (built for this test server by the webServer command), loaded into
 * Chromium: quick notes without an account, then account mode with an API key.
 */
const EXTENSION = resolve('dist-extension/chrome');
const BASE = 'http://127.0.0.1:8788';

let context: BrowserContext;
let extensionId: string;

test.beforeAll(async () => {
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium', // the new headless mode, which runs extensions
    args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
  });
  await useFreshClientIp(context);
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  extensionId = new URL(worker.url()).host;
});
test.afterAll(async () => context?.close());

test('extension: a quick note is encrypted in the extension and opens once on the site', async () => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(popup.getByText('Quick note, no account needed')).toBeVisible();
  const secret = `from the toolbar ${Date.now()}`;
  await popup.getByLabel('Note', { exact: true }).fill(secret);
  await popup.locator('#quick-reads').selectOption('1');
  await popup.getByRole('button', { name: 'Create secure link' }).click();
  await expect(popup.getByRole('heading', { name: 'Your link is ready' })).toBeVisible({ timeout: 15_000 });
  const link = await popup.getByLabel('Link', { exact: true }).inputValue();
  expect(link).toMatch(new RegExp(`^${BASE}/n/[A-Za-z0-9_-]{22}#[A-Za-z0-9_-]{43}$`));
  await expect(popup.getByLabel('Your private destroy link')).toHaveValue(new RegExp(`^${BASE}/d/`));

  const site = await context.newPage();
  await site.goto(link);
  await site.getByRole('button', { name: 'Open and read note' }).click();
  await expect(site.locator('#note-content')).toHaveText(secret);
  await site.reload();
  await site.getByRole('button', { name: 'Open and read note' }).click();
  await expect(site.getByRole('heading', { name: 'This note is gone' })).toBeVisible();
});

test('extension: with an API key, notes go to the dashboard and team rules show in the form', async () => {
  // An account and API key, made through the API like a person would through the site.
  const email = `ext-${Date.now()}@example.com`;
  const authKey = await deriveAuthKey(email, 'extension test password');
  const request = context.request;
  expect((await request.post(`${BASE}/api/auth/signup`, { data: { name: 'Eli', email, authKey, acceptTerms: true } })).status()).toBe(202);
  const outbox = await (await request.get(`${BASE}/api/dev/outbox?to=${encodeURIComponent(email)}`)).json();
  const token = (outbox.emails[0].text as string).match(/\/verify#([A-Za-z0-9_-]{43})/)![1];
  expect((await request.post(`${BASE}/api/auth/verify`, { data: { token } })).status()).toBe(200);
  const { key } = await (await request.post(`${BASE}/api/account/api-key`, { data: { authKey } })).json();

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.getByLabel('API key').fill(key);
  await options.getByRole('button', { name: 'Save' }).click();
  await expect(options.getByText('Connected as Eli')).toBeVisible();

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(popup.getByText('Saved to Eli’s team’s dashboard as Eli')).toBeVisible();
  await popup.getByLabel('Title').fill('Office Wi-Fi');
  await popup.getByLabel('Note', { exact: true }).fill('wifi: correct horse');
  await popup.getByRole('button', { name: 'Create secure link' }).click();
  await expect(popup.getByRole('heading', { name: 'Your link is ready' })).toBeVisible({ timeout: 15_000 });
  await expect(popup.getByLabel('Your private destroy link')).toBeHidden();

  const records = await (await request.get(`${BASE}/api/account/records`, { headers: { Authorization: `Bearer ${key}` } })).json();
  expect(records.records.map((r: { title: string }) => r.title)).toContain('Office Wi-Fi');
});

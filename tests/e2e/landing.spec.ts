import { expect, test } from '@playwright/test';
import { useFreshClientIp } from './client-ip';

test.beforeEach(async ({ page, context }) => {
  await useFreshClientIp(context);
  page.on('dialog', (dialog) => void dialog.accept().catch(() => {}));
});

test('password generator → send as a note → recipient reads the same password', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/password-generator');
  const output = page.getByLabel('Generated password');
  await expect(output).toHaveValue(/^.{20}$/);
  await expect(page.getByText(/Very strong · about \d+ bits/)).toBeVisible();

  // Changing an option makes a new password that follows it.
  await page.getByLabel('Uppercase (A–Z)').uncheck();
  await page.getByLabel('Symbols (!@#…)').uncheck();
  await expect(output).toHaveValue(/^[a-z0-9]{20}$/);

  const password = await output.inputValue();
  await page.getByRole('button', { name: 'Send it as a self-destructing note' }).click();
  await expect(page.getByLabel('Your note')).toHaveValue(password);

  await page.getByRole('button', { name: 'Create secure link' }).click();
  await expect(page.getByRole('heading', { name: 'Your link is ready' })).toBeVisible({ timeout: 15_000 });
  const link = await page.getByLabel('Share this link').inputValue();

  await page.goto(link);
  await page.getByRole('button', { name: 'Open and read note' }).click();
  await expect(page.locator('#note-content')).toHaveText(password);
  expect(errors).toEqual([]);
});

for (const path of ['/send-password-securely', '/one-time-secret-link', '/share-api-keys']) {
  test(`${path} has a working note form and no analytics`, async ({ page }) => {
    const external: string[] = [];
    page.on('request', (req) => new URL(req.url()).hostname !== '127.0.0.1' && external.push(req.url()));
    await page.goto(path);
    await expect(page.locator('h1')).toBeVisible();
    await page.getByLabel('Your note').fill('landing page note');
    await page.getByRole('button', { name: 'Create secure link' }).click();
    await expect(page.getByRole('heading', { name: 'Your link is ready' })).toBeVisible({ timeout: 15_000 });
    expect(external).toEqual([]);
  });
}

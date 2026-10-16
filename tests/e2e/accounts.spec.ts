import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { useFreshClientIp } from './client-ip';

test.describe.configure({ mode: 'serial' });

/** Console errors (including CSP violations), ignoring the third-party Turnstile widget and expected 4xx fetches. */
function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const where = msg.location().url;
    if (where.includes('challenges.cloudflare.com')) return;
    if (/status of 40[134]/.test(msg.text()) && where.includes('/api/')) return;
    errors.push(`${msg.text()} @ ${where}`);
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

test.beforeEach(async ({ page, context }) => {
  await useFreshClientIp(context);
  page.on('dialog', (dialog) => void dialog.accept().catch(() => {}));
});

async function signUp(page: Page, name = 'Robin Test') {
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  const password = 'a long enough password';
  await page.goto('/signup');
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByLabel(/I agree to the/).check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Check your email.')).toBeVisible({ timeout: 20_000 });

  const outbox = await (await page.request.get(`/api/dev/outbox?to=${encodeURIComponent(email)}`)).json();
  const link = (outbox.emails[0].text as string).match(/\/verify#[A-Za-z0-9_-]{43}/)![0];
  await page.goto(link);
  await page.getByRole('button', { name: 'Confirm my email' }).click();
  await expect(page).toHaveURL(/\/app$/);
  return { email, password };
}

async function newContext(browser: Browser) {
  const context = await browser.newContext();
  await useFreshClientIp(context);
  const page = await context.newPage();
  page.on('dialog', (dialog) => void dialog.accept().catch(() => {}));
  return { context, page };
}

test('the dashboard requires a session', async ({ page }) => {
  await page.goto('/app/settings');
  await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Fsettings$/);
});

test('sign up → verify → empty dashboard → log out → log in', async ({ page }) => {
  const errors = trackConsoleErrors(page);
  const { email, password } = await signUp(page);
  await expect(page.getByRole('heading', { name: 'Your notes will appear here' })).toBeVisible();
  // Free: notes are unlimited (no meter); information requests are capped at 2 a month.
  await expect(page.getByText('2 left')).toBeVisible();

  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });
  expect(errors).toEqual([]);
});

test('account note with password, hint and attachment, end to end', async ({ page, browser }) => {
  const errors = trackConsoleErrors(page);
  await signUp(page, 'Sam Sender');

  await page.getByRole('button', { name: 'Create note' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New note' });
  await dialog.getByLabel('Title').fill('Router admin');
  await dialog.getByLabel('Password (optional)').fill('blue-harbor-42');
  await dialog.getByLabel('Confirm password').fill('blue-harbor-42');
  await dialog.getByLabel('Password hint (optional)').fill('the boat + year');
  await dialog.getByLabel('Note contents').fill('admin / hunter2');
  await dialog.locator('[data-file-input]').setInputFiles({
    name: 'config.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('ssid=home\npsk=supersecret\n'),
  });
  await expect(dialog.getByText('config.txt')).toBeVisible();
  await dialog.getByRole('button', { name: 'Create note' }).click();

  await expect(dialog.getByRole('heading', { name: 'Your note is ready' })).toBeVisible({ timeout: 20_000 });
  const link = await dialog.getByLabel('Link', { exact: true }).inputValue();
  expect(link).toMatch(/\/n\/[A-Za-z0-9_-]{22}#[A-Za-z0-9_-]{43}$/);
  await dialog.getByRole('button', { name: 'Copy link' }).click();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('Router admin')).toBeVisible();
  await expect(page.getByText('Waiting to be read')).toBeVisible();

  // Recipient, in a separate browser context.
  const recipient = await newContext(browser);
  const r = recipient.page;
  const recipientErrors = trackConsoleErrors(r);
  await r.goto(link);
  await r.getByRole('button', { name: 'Open and read note' }).click();
  await expect(r.getByText('Hint from the sender: the boat + year')).toBeVisible();
  await r.getByLabel('Password').fill('wrong');
  await r.getByRole('button', { name: 'Unlock note' }).click();
  await expect(r.getByRole('alert')).toContainText("didn't work");
  await r.getByLabel('Password').fill('blue-harbor-42');
  await r.getByRole('button', { name: 'Unlock note' }).click();
  await expect(r.locator('#note-content')).toHaveText('admin / hunter2');
  await expect(r.getByText('config.txt')).toBeVisible();

  const [download] = await Promise.all([r.waitForEvent('download'), r.getByRole('button', { name: 'Download and decrypt' }).click()]);
  expect(download.suggestedFilename()).toBe('config.txt');
  expect(await readFile((await download.path())!, 'utf8')).toBe('ssid=home\npsk=supersecret\n');
  await recipient.context.close();
  expect(recipientErrors).toEqual([]);

  // Back in the dashboard: shredded, and activity is gone on the Free plan.
  await page.reload();
  await expect(page.getByText('Read & shredded')).toBeVisible();
  expect(errors).toEqual([]);
});

test('information request: create, answer anonymously, open with the request password', async ({ page, browser }) => {
  const errors = trackConsoleErrors(page);
  await signUp(page, 'Ana Requester');

  await page.getByRole('button', { name: 'Create request' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New information request' });
  await dialog.getByLabel('Title').fill('Passport number');
  await dialog.getByLabel('Request password').fill('request-pass-1');
  await dialog.getByLabel('Confirm password').fill('request-pass-1');
  await dialog.getByLabel('Message (optional)').fill('Please send your passport number for the booking.');
  await dialog.getByRole('button', { name: 'Create request' }).click();
  await expect(dialog.getByRole('heading', { name: 'Your request is ready' })).toBeVisible({ timeout: 20_000 });
  const link = await dialog.getByLabel('Request link', { exact: true }).inputValue();
  expect(link).toMatch(/\/r\/[A-Za-z0-9_-]{22}#[A-Za-z0-9_-]{43}$/);
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('Waiting for reply')).toBeVisible();

  // A tampered fingerprint is caught before anything is sent.
  const responder = await newContext(browser);
  const r = responder.page;
  const responderErrors = trackConsoleErrors(r);
  await r.goto(link.replace(/#.+$/, '#' + 'A'.repeat(43)));
  await expect(r.getByRole('heading', { name: 'This link doesn’t match the request' })).toBeVisible();

  await r.goto('about:blank');
  await r.goto(link);
  await expect(r.getByRole('heading', { name: 'Passport number' })).toBeVisible();
  await expect(r.getByText('Please send your passport number for the booking.')).toBeVisible();
  await r.getByLabel('Your reply').fill('P1234567');
  await r.getByRole('button', { name: 'Encrypt and send' }).click();
  await expect(r.getByRole('heading', { name: 'Sent securely' })).toBeVisible();
  await r.goto('about:blank');
  await r.goto(link);
  await expect(r.getByRole('heading', { name: 'This request is closed' })).toBeVisible();
  await responder.context.close();
  expect(responderErrors).toEqual([]);

  await page.reload();
  await page.getByRole('button', { name: 'Open response' }).click();
  const open = page.getByRole('dialog', { name: 'Open response' });
  await open.getByLabel('Request password').fill('nope');
  await open.getByRole('button', { name: 'Unlock' }).click();
  await expect(open.getByRole('alert')).toContainText('Nothing has been opened yet');
  await open.getByLabel('Request password').fill('request-pass-1');
  await open.getByRole('button', { name: 'Unlock' }).click();
  await expect(open.locator('#or-content')).toHaveText('P1234567');
  await open.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('Opened & shredded')).toBeVisible();
  expect(errors).toEqual([]);
});

test('dashboard pages load without CSP errors, and are never indexed', async ({ page }) => {
  const errors = trackConsoleErrors(page);
  await signUp(page);
  for (const path of ['/app', '/app/team', '/app/admin', '/app/settings', '/app/subscription', '/app/contact']) {
    const res = await page.goto(path);
    expect(res!.headers()['x-robots-tag']).toContain('noindex');
    expect(res!.headers()['cache-control']).toContain('no-store');
    await expect(page.locator('h1')).toHaveCount(1);
  }
  await page.goto('/app/subscription');
  await expect(page.getByText('Your current plan')).toBeVisible();
  await page.goto('/app/team');
  await expect(page.getByText('The Free plan is for one person.')).toBeVisible();
  await page.goto('/app/admin');
  await expect(page.getByRole('heading', { name: 'Team admin is included in Standard and Business' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('team admin: a policy set by the owner shapes the note form, and lands in the audit log', async ({ page }) => {
  const errors = trackConsoleErrors(page);
  const { email } = await signUp(page, 'Olive Owner');
  // Plans are set in the database (billing isn't wired up); the e2e server uses the local D1.
  // Run wrangler's script with this Node directly: no shell, so the SQL needs no quoting.
  execFileSync(
    process.execPath,
    [
      'node_modules/wrangler/bin/wrangler.js',
      'd1',
      'execute',
      'vanishnote-db',
      '--local',
      '--command',
      `UPDATE teams SET plan = 'standard' WHERE id = (SELECT team_id FROM users WHERE email = '${email}')`,
    ],
    { stdio: 'ignore' },
  );

  await page.goto('/app/admin');
  await page.getByLabel('Require a password on every note').check();
  await page.getByLabel('Longest a note or request can live').selectOption('1d');
  await page.getByRole('button', { name: 'Save policies' }).click();
  await expect(page.getByText('Policies saved.')).toBeVisible();

  await page.goto('/app');
  await page.getByRole('button', { name: 'Create note' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New note' });
  await expect(dialog.getByText('(required by your team)')).toBeVisible();
  await expect(dialog.getByText('Unread notes are deleted after 1 day (your team’s policy).')).toBeVisible();
  await dialog.getByLabel('Title').fill('No password');
  await dialog.getByLabel('Note contents').fill('secret');
  await dialog.getByRole('button', { name: 'Create note' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Your team requires a password on every note.');
  await dialog.getByRole('button', { name: 'Close' }).first().click();

  await page.goto('/app/admin');
  const log = page.getByRole('table');
  await expect(log.getByText('Changed team policies')).toBeVisible();
  const csv = await page.request.get('/api/account/team/audit.csv');
  expect(csv.headers()['content-type']).toContain('text/csv');
  expect(await csv.text()).toContain('passwords required, notes last at most 1 day');
  expect(errors).toEqual([]);
});

test('pricing page: three plans, monthly/yearly toggle', async ({ page }) => {
  const errors = trackConsoleErrors(page);
  await page.goto('/pricing');
  await expect(page.getByRole('heading', { name: 'Free', exact: true })).toBeVisible();
  await expect(page.getByText('Most popular')).toBeVisible();
  const business = page.locator('section', { has: page.getByRole('heading', { name: 'Business', exact: true }) });
  await expect(business.locator('[data-monthly]')).toHaveText('30');
  await page.getByRole('button', { name: /Yearly/ }).click();
  await expect(business.locator('[data-monthly]')).toHaveText('24');
  await expect(business.getByText('Billed yearly at $288')).toBeVisible();
  expect(errors).toEqual([]);
});

test('settings: two-factor sign-in on a new device, API key, consent', async ({ page, browser }) => {
  const errors = trackConsoleErrors(page);
  const { email, password } = await signUp(page, 'Sec Ure');
  await page.goto('/app/settings');

  // Consent was recorded at sign-up.
  await page.getByRole('button', { name: 'Terms & privacy consent' }).click();
  const consent = page.getByRole('dialog', { name: 'Terms & privacy consent' });
  await expect(consent.getByText('That’s the current version. Nothing to do.')).toBeVisible();
  await consent.getByRole('button', { name: 'Close' }).last().click();

  // API key: needs the password, shown once.
  const apiCard = page.locator('#api-key');
  await apiCard.getByRole('button', { name: 'Create API key' }).click();
  await apiCard.getByLabel('Confirm with your password').fill(password);
  await apiCard.getByRole('button', { name: 'Confirm' }).click();
  await expect(apiCard.getByLabel('New API key')).toHaveValue(/^vn_[A-Za-z0-9_-]{43}$/, { timeout: 20_000 });
  const key = await apiCard.getByLabel('New API key').inputValue();
  const viaKey = await page.request.get('/api/account/records', { headers: { Authorization: `Bearer ${key}`, Cookie: '' } });
  expect(viaKey.status()).toBe(200);

  // Two-factor on.
  const tf = page.locator('#two-factor');
  await tf.getByRole('button', { name: 'Enable two-factor authentication' }).click();
  await tf.getByLabel('Confirm with your password').fill(password);
  await tf.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.locator('#two-factor').getByRole('button', { name: 'Disable two-factor authentication' })).toBeVisible();

  // A different browser needs the emailed code.
  const other = await browser.newContext();
  await other.setExtraHTTPHeaders({ 'CF-Connecting-IP': `198.51.100.${Math.floor(Math.random() * 200) + 1}` });
  const p2 = await other.newPage();
  await p2.goto('/login');
  await p2.getByLabel('Email').fill(email);
  await p2.getByLabel('Password', { exact: true }).fill(password);
  await p2.getByRole('button', { name: 'Log in' }).click();
  await expect(p2.getByLabel('Sign-in code')).toBeVisible({ timeout: 20_000 });
  const outbox = await (await p2.request.get(`/api/dev/outbox?to=${encodeURIComponent(email)}`)).json();
  const code = (outbox.emails[0].subject as string).slice(0, 6);
  expect(code).toMatch(/^\d{6}$/);
  await p2.getByLabel('Sign-in code').fill(code);
  await p2.getByRole('button', { name: 'Verify and log in' }).click();
  await expect(p2).toHaveURL(/\/app$/);

  // Now that browser is remembered: logging out and back in skips the code.
  await p2.getByRole('button', { name: 'Log out' }).click();
  await p2.getByLabel('Email').fill(email);
  await p2.getByLabel('Password', { exact: true }).fill(password);
  await p2.getByRole('button', { name: 'Log in' }).click();
  await expect(p2).toHaveURL(/\/app$/, { timeout: 20_000 });
  await other.close();
  expect(errors).toEqual([]);
});

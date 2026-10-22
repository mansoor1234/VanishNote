// Screenshots of the extension popup for the /extension page (light and dark), at 2x.
// Run after `npm run build:extension`: node scripts/screenshot-extension.mjs
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ext = fileURLToPath(new URL('../dist-extension/chrome', import.meta.url));
for (const scheme of ['light', 'dark']) {
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    colorScheme: scheme,
    deviceScaleFactor: 2,
    viewport: { width: 380, height: 600 },
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const page = await context.newPage();
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
  await page.getByLabel('Note', { exact: true }).fill('Server root password:\ncorrect-horse-battery-staple');
  await page.getByLabel('Password', { exact: false }).first().fill('blue-harbor-42');
  await page.getByLabel('Confirm').fill('blue-harbor-42');
  await page.locator('#expires').selectOption('1d');
  await page.evaluate(() => /** @type {HTMLElement} */ (document.activeElement)?.blur());
  await page.screenshot({ path: fileURLToPath(new URL(`../public/extension-popup-${scheme}.png`, import.meta.url)) });
  console.log(`wrote public/extension-popup-${scheme}.png`);
  await context.close();
}

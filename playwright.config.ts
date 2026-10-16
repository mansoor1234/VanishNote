import { defineConfig, devices } from '@playwright/test';

const PORT = 8788;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? 'github' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    permissions: ['clipboard-read', 'clipboard-write'],
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /flow\.spec\.ts/, grep: /create → open/ },
  ],
  // Runs the production build on workerd with a local D1, exactly as it will be deployed.
  webServer: {
    // DEV_OUTBOX writes emails to D1 (readable at /api/dev/outbox) so tests can follow verification links.
    // wrangler.toml holds production vars; point emails at this server and use Turnstile's test key.
    // The browser extension is built against this server for tests/e2e/extension.spec.ts.
    command:
      `npm run build && node scripts/build-extension.mjs --server http://127.0.0.1:${PORT} && npm run db:migrate:local && npx wrangler dev --port ${PORT} --ip 127.0.0.1 --var DEV_OUTBOX:true` +
      ` --var APP_URL:http://127.0.0.1:${PORT} --var TURNSTILE_SITE_KEY:1x00000000000000000000AA`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env['CI'],
    timeout: 180_000,
  },
});

// Renders the 1200×630 social cards: public/og.png (marketing pages) and public/og-note.png
// (note links — deliberately generic, it must reveal nothing about any note).
// Run: node scripts/generate-og.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const mark = readFileSync(new URL('../public/favicon.svg', import.meta.url), 'utf8')
  .replace(/<style>.*?<\/style>/, '')
  .replace('<svg ', '<svg width="132" height="132" ');

const page = (headline, sub) => `<!doctype html><html><head><style>
  body { margin:0; width:1200px; height:630px; display:flex; flex-direction:column; justify-content:center;
    padding:0 96px; box-sizing:border-box; background:#f6f5f1; color:#1b1d2a;
    font-family: "Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif; }
  .brand { display:flex; align-items:center; gap:28px; color:#4338ca; }
  .word { font-size:76px; font-weight:800; letter-spacing:-2px; color:#1b1d2a; }
  .word span { color:#545869; }
  h1 { font-size:56px; line-height:1.12; margin:56px 0 20px; letter-spacing:-1.5px; max-width:1010px; }
  p { font-size:30px; color:#545869; margin:0; }
  .bits { position:absolute; right:84px; bottom:72px; display:flex; gap:14px; align-items:flex-end; }
  .bits i { display:block; background:#4338ca; border-radius:6px; }
</style></head><body>
  <div class="brand">${mark}<div class="word">vanish<span>note</span></div></div>
  <h1>${headline}</h1>
  <p>${sub}</p>
  <div class="bits"><i style="width:34px;height:34px;opacity:.85"></i><i style="width:24px;height:24px;opacity:.55"></i><i style="width:16px;height:16px;opacity:.35"></i></div>
</body></html>`;

const cards = {
  'og.png': page("Notes even we can't read.", 'Encrypted in your browser · Destroyed after reading · No sign-up'),
  'og-note.png': page('🔒 A private note for you', 'Encrypted · Opens once · No account needed'),
};

const browser = await chromium.launch();
const tab = await browser.newPage({ viewport: { width: 1200, height: 630 } });
for (const [file, html] of Object.entries(cards)) {
  await tab.setContent(html);
  await tab.screenshot({ path: fileURLToPath(new URL(`../public/${file}`, import.meta.url)) });
  console.log(`wrote public/${file}`);
}
// App icon for push notifications.
const icon = await browser.newPage({ viewport: { width: 192, height: 192 } });
await icon.setContent(
  `<body style="margin:0;width:192px;height:192px;display:flex;align-items:center;justify-content:center;background:#4338ca;color:#fff">${mark
    .replace('width="132" height="132"', 'width="128" height="128"')
    .replace(/currentColor/g, '#ffffff')}</body>`,
);
await icon.screenshot({ path: fileURLToPath(new URL('../public/icon-192.png', import.meta.url)) });
console.log('wrote public/icon-192.png');
await browser.close();

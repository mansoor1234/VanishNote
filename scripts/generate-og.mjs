// Renders public/og.png (1200×630) for social cards. Run: node scripts/generate-og.mjs
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const mark = readFileSync(new URL('../public/favicon.svg', import.meta.url), 'utf8')
  .replace(/<style>.*?<\/style>/, '')
  .replace('<svg ', '<svg width="132" height="132" ');

const html = `<!doctype html><html><head><style>
  body { margin:0; width:1200px; height:630px; display:flex; flex-direction:column; justify-content:center;
    padding:0 96px; box-sizing:border-box; background:#f6f5f1; color:#1b1d2a;
    font-family: "Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif; }
  .brand { display:flex; align-items:center; gap:28px; color:#4338ca; }
  .word { font-size:76px; font-weight:800; letter-spacing:-2px; color:#1b1d2a; }
  .word span { color:#545869; }
  h1 { font-size:58px; line-height:1.12; margin:56px 0 20px; letter-spacing:-1.5px; max-width:980px; }
  p { font-size:30px; color:#545869; margin:0; }
  .bits { position:absolute; right:84px; bottom:72px; display:flex; gap:14px; align-items:flex-end; }
  .bits i { display:block; background:#4338ca; border-radius:6px; }
</style></head><body>
  <div class="brand">${mark}<div class="word">vanish<span>note</span></div></div>
  <h1>Send a secret that vanishes once it's read.</h1>
  <p>Encrypted in your browser · Burn after reading · No sign-up</p>
  <div class="bits"><i style="width:34px;height:34px;opacity:.85"></i><i style="width:24px;height:24px;opacity:.55"></i><i style="width:16px;height:16px;opacity:.35"></i></div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html);
await page.screenshot({ path: new URL('../public/og.png', import.meta.url).pathname.replace(/^\/(\w:)/, '$1') });
await browser.close();
console.log('wrote public/og.png');

// Renders the 1200×630 social cards: public/og.png (marketing pages) and public/og-note.png
// (note links — deliberately generic, it must reveal nothing about any note), plus the app icons.
// Run: node scripts/generate-og.mjs
import { readFileSync, writeFileSync } from 'node:fs';
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
// Square app icons: white mark on the brand indigo, legible on light and dark backgrounds.
// icon-192: push notifications. favicon-48/96 and favicon.ico: browsers and Google Search, which
// wants a square PNG in multiples of 48px. apple-touch-icon: iOS home screen.
async function renderIcon(size) {
  const tab = await browser.newPage({ viewport: { width: size, height: size } });
  const markSize = Math.round(size * (128 / 192));
  await tab.setContent(
    `<body style="margin:0;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;background:#4338ca">${mark
      .replace('width="132" height="132"', `width="${markSize}" height="${markSize}"`)
      .replace(/currentColor/g, '#ffffff')}</body>`,
  );
  const png = await tab.screenshot();
  await tab.close();
  return png;
}

for (const [file, size] of [['icon-192.png', 192], ['favicon-48.png', 48], ['favicon-96.png', 96], ['apple-touch-icon.png', 180]]) {
  writeFileSync(fileURLToPath(new URL(`../public/${file}`, import.meta.url)), await renderIcon(size));
  console.log(`wrote public/${file}`);
}

// favicon.ico holding PNG images (valid since Windows Vista; every current browser reads it).
const icoImages = [[32, await renderIcon(32)], [48, await renderIcon(48)]];
const header = Buffer.alloc(6 + 16 * icoImages.length);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(icoImages.length, 4);
let offset = header.length;
icoImages.forEach(([size, png], i) => {
  const entry = 6 + 16 * i;
  header.writeUInt8(size, entry); // width
  header.writeUInt8(size, entry + 1); // height
  header.writeUInt16LE(1, entry + 4); // colour planes
  header.writeUInt16LE(32, entry + 6); // bits per pixel
  header.writeUInt32LE(png.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += png.length;
});
writeFileSync(fileURLToPath(new URL('../public/favicon.ico', import.meta.url)), Buffer.concat([header, ...icoImages.map(([, png]) => png)]));
console.log('wrote public/favicon.ico');
await browser.close();

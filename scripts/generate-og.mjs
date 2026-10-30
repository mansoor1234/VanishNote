// Renders the 1200×630 social cards: public/og.png (marketing pages) and public/og-note.png
// (note links — deliberately generic, it must reveal nothing about any note), plus the app icons.
// Run: node scripts/generate-og.mjs
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// The logo mark's single source. The browser-tab icon is the mark itself.
const markSource = readFileSync(new URL('../src/assets/logo-mark.svg', import.meta.url), 'utf8').trim();
writeFileSync(fileURLToPath(new URL('../public/favicon.svg', import.meta.url)), `${markSource}\n`);
console.log('wrote public/favicon.svg');
const markAt = (size) => markSource.replace('<svg ', `<svg width="${size}" height="${size}" `);
const mark = markAt(132);

const page = (headline, sub) => `<!doctype html><html><head><style>
  body { margin:0; width:1200px; height:630px; display:flex; flex-direction:column; justify-content:center;
    padding:0 96px; box-sizing:border-box; background:#f6f5f1; color:#1b1d2a;
    font-family: "Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif; }
  .brand { display:flex; align-items:center; gap:28px; }
  .word { font-size:76px; font-weight:800; letter-spacing:-2px; color:#0b1020; }
  h1 { font-size:56px; line-height:1.12; margin:56px 0 20px; letter-spacing:-1.5px; max-width:1010px; }
  p { font-size:30px; color:#545869; margin:0; }
  .bits { position:absolute; right:84px; bottom:72px; display:flex; gap:14px; align-items:flex-end; }
  .bits i { display:block; background:#4f5cf3; border-radius:6px; }
</style></head><body>
  <div class="brand">${mark}<div class="word">Vanishnote</div></div>
  <h1>${headline}</h1>
  <p>${sub}</p>
  <div class="bits"><i style="width:34px;height:34px;opacity:.85"></i><i style="width:24px;height:24px;opacity:.55"></i><i style="width:16px;height:16px;opacity:.35"></i></div>
</body></html>`;

const cards = {
  'og.png': page("Notes even we can't read.", 'Encrypted in your browser · Destroyed after reading · No sign-up'),
  'og-note.png': page('🔒 A private note for you', 'Encrypted · Opens once · No account needed'),
};

/**
 * Per-page social cards (public/og/<name>.png) for the pages people share and search for. Base.astro
 * picks them up from src/lib/og-manifest.json; pages not listed keep og.png. Blog posts are added
 * from their Markdown front matter. Keep headlines short: they wrap at about 34 characters a line.
 */
const PAGE_CARDS = [
  ['/pricing', 'pricing', 'Simple plans. The same encryption on all of them.', 'Free for one person · Standard $5/user · Business $30 flat'],
  ['/security', 'security', 'We can’t read your notes. Here’s exactly why.', 'What our servers see, what they never see, and the limits'],
  ['/how-it-works', 'how-it-works', 'How a note we can’t read gets to your recipient', 'Encrypted in your browser · Key in the link · Burned on reading'],
  ['/faq', 'faq', 'Questions about self-destructing notes, answered', 'Encryption · Link previews · Passwords · Expiry · Accounts'],
  ['/extension', 'extension', 'Send a secret from any page in two clicks.', 'Free extension for Chrome, Edge and Firefox'],
  ['/blog', 'blog', 'Sharing secrets without leaving them lying around', 'Practical guides from the Vanishnote blog'],
  ['/send-password-securely', 'send-password-securely', 'Send a password that doesn’t stay in anyone’s inbox', 'A one-time link, encrypted in your browser · Free'],
  ['/one-time-secret-link', 'one-time-secret-link', 'A secret link that works once, then destroys itself', 'End-to-end encrypted · Free · No sign-up'],
  ['/share-api-keys', 'share-api-keys', 'Share API keys and .env files without leaving them in Slack', 'One-time links for developers · Encrypted in your browser'],
  ['/password-generator', 'password-generator', 'A strong password, made on your device', 'Free generator · Then share it as a one-time link'],
  ['/privnote-alternative', 'privnote-alternative', 'Vanishnote vs Privnote', 'An honest comparison: encryption, options and accounts'],
  ['/onetimesecret-alternative', 'onetimesecret-alternative', 'Vanishnote vs One-Time Secret', 'An honest comparison: where your secret is encrypted'],
];
const blogDir = new URL('../src/content/blog/', import.meta.url);
for (const file of readdirSync(blogDir).filter((f) => f.endsWith('.md'))) {
  const front = readFileSync(new URL(file, blogDir), 'utf8').split('---')[1] ?? '';
  const title = front.match(/^title:\s*(.+)$/m)?.[1].trim().replace(/^(['"])(.*)\1$/, '$2');
  const slug = file.replace(/\.md$/, '');
  if (title) PAGE_CARDS.push([`/blog/${slug}`, `blog-${slug}`, title, 'From the Vanishnote blog']);
}
const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const browser = await chromium.launch();
const tab = await browser.newPage({ viewport: { width: 1200, height: 630 } });
for (const [file, html] of Object.entries(cards)) {
  await tab.setContent(html);
  await tab.screenshot({ path: fileURLToPath(new URL(`../public/${file}`, import.meta.url)) });
  console.log(`wrote public/${file}`);
}
mkdirSync(fileURLToPath(new URL('../public/og', import.meta.url)), { recursive: true });
const manifest = {};
for (const [path, name, headline, sub] of PAGE_CARDS) {
  await tab.setContent(page(escapeHtml(headline), escapeHtml(sub)));
  await tab.screenshot({ path: fileURLToPath(new URL(`../public/og/${name}.png`, import.meta.url)) });
  manifest[path] = { image: `/og/${name}.png`, alt: `${headline} (Vanishnote)` };
}
writeFileSync(fileURLToPath(new URL('../src/lib/og-manifest.json', import.meta.url)), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${PAGE_CARDS.length} page cards and src/lib/og-manifest.json`);
// App icon: the mark on a deep navy-to-violet tile, legible on light and dark backgrounds.
// favicon-48/96 and favicon.ico (browsers and Google Search, which wants a square PNG in
// multiples of 48px) have rounded corners; apple-touch-icon and icon-192 (push) are full-bleed
// because iOS and notification UIs apply their own mask.
async function renderIcon(size, { rounded }) {
  const tab = await browser.newPage({ viewport: { width: size, height: size } });
  const radius = rounded ? Math.round(size * 0.22) : 0;
  await tab.setContent(
    `<body style="margin:0;width:${size}px;height:${size}px;background:transparent">
      <div style="width:${size}px;height:${size}px;border-radius:${radius}px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#071a5e,#2a0c8f)">
        ${markAt(Math.round(size * 0.7))}
      </div></body>`,
  );
  const png = await tab.screenshot({ omitBackground: true });
  await tab.close();
  return png;
}

for (const [file, size, rounded] of [
  ['icon-192.png', 192, false],
  // Organization logo in structured data and the web app manifest.
  ['icon-512.png', 512, false],
  ['apple-touch-icon.png', 180, false],
  ['favicon-48.png', 48, true],
  ['favicon-96.png', 96, true],
]) {
  writeFileSync(fileURLToPath(new URL(`../public/${file}`, import.meta.url)), await renderIcon(size, { rounded }));
  console.log(`wrote public/${file}`);
}

// Browser extension toolbar and store icons.
mkdirSync(fileURLToPath(new URL('../extension/static/icons', import.meta.url)), { recursive: true });
for (const size of [16, 32, 48, 128]) {
  writeFileSync(fileURLToPath(new URL(`../extension/static/icons/icon-${size}.png`, import.meta.url)), await renderIcon(size, { rounded: true }));
}
console.log('wrote extension/static/icons');

// favicon.ico holding PNG images (valid since Windows Vista; every current browser reads it).
const icoImages = [[32, await renderIcon(32, { rounded: true })], [48, await renderIcon(48, { rounded: true })]];
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

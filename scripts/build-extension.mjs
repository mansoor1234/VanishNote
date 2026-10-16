// Builds the browser extension for Chrome/Edge and Firefox into dist-extension/, plus store zips.
// Run: node scripts/build-extension.mjs [--server http://localhost:8787]
// The server defaults to production; a local server is for testing only.
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const serverArg = args.indexOf('--server');
const server = (serverArg >= 0 ? args[serverArg + 1] : 'https://vanishnote.net').replace(/\/$/, '');
const origin = new URL(server).origin;
const version = JSON.parse(readFileSync(join(root, 'extension/version.json'), 'utf8')).version;

const base = {
  manifest_version: 3,
  name: 'Vanishnote: self-destructing notes',
  short_name: 'Vanishnote',
  version,
  description: 'Send passwords and private notes as encrypted links that self-destruct after reading. Encrypted in your browser.',
  homepage_url: 'https://vanishnote.net',
  icons: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' },
  action: { default_title: 'Vanishnote', default_popup: 'popup.html', default_icon: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png' } },
  options_ui: { page: 'options.html', open_in_tab: true },
  // contextMenus: the right-click item. storage: the optional API key. Nothing else.
  permissions: ['contextMenus', 'storage'],
  // Only the Vanishnote server: the extension never reads or changes the pages you visit.
  host_permissions: [`${origin}/*`],
  content_security_policy: { extension_pages: "script-src 'self'; object-src 'none'; base-uri 'none'" },
};

const targets = {
  chrome: { ...base, background: { service_worker: 'background.js', type: 'module' }, minimum_chrome_version: '116' },
  firefox: {
    ...base,
    background: { scripts: ['background.js'], type: 'module' },
    browser_specific_settings: { gecko: { id: 'extension@vanishnote.net', strict_min_version: '121.0' } },
  },
};

const outRoot = join(root, 'dist-extension');
rmSync(outRoot, { recursive: true, force: true });

for (const [target, manifest] of Object.entries(targets)) {
  const out = join(outRoot, target);
  mkdirSync(join(out, 'icons'), { recursive: true });
  await build({
    entryPoints: ['popup', 'options', 'background'].map((n) => join(root, `extension/src/${n}.ts`)),
    outdir: out,
    bundle: true,
    format: 'esm',
    target: ['chrome116', 'firefox121'],
    minify: true,
    legalComments: 'none',
    define: { __SERVER__: JSON.stringify(server) },
    logLevel: 'warning',
  });
  for (const file of readdirSync(join(root, 'extension/static'), { recursive: true, withFileTypes: true })) {
    if (!file.isFile()) continue;
    const rel = join(file.parentPath ?? file.path, file.name).slice(join(root, 'extension/static').length + 1);
    mkdirSync(join(out, rel, '..'), { recursive: true });
    copyFileSync(join(root, 'extension/static', rel), join(out, rel));
  }
  copyFileSync(join(root, 'src/assets/logo-mark.svg'), join(out, 'icons/mark.svg'));
  writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  if (server === 'https://vanishnote.net') {
    writeFileSync(join(outRoot, `vanishnote-${target}-${version}.zip`), zip(out));
  }
  console.log(`built dist-extension/${target} (${server})`);
}

/** Minimal zip writer (deflate), enough for extension stores. */
function zip(dir) {
  const files = readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((f) => f.isFile())
    .map((f) => join(f.parentPath ?? f.path, f.name))
    .sort();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const path of files) {
    const name = Buffer.from(path.slice(dir.length + 1).replaceAll('\\', '/'));
    const data = readFileSync(path);
    const packed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12); // 1980-01-01, fixed for reproducible builds
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, packed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + packed.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

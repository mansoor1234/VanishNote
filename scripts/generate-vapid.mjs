// Generate a Web Push (VAPID) key pair. Run: node scripts/generate-vapid.mjs
// Put the public key in wrangler.toml (VAPID_PUBLIC_KEY) and the private key in a secret:
//   npx wrangler secret put VAPID_PRIVATE_KEY
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
const b64url = (bytes) => Buffer.from(bytes).toString('base64url');

console.log(`VAPID_PUBLIC_KEY=${b64url(raw)}`);
console.log(`VAPID_PRIVATE_KEY=${jwk.d}`);

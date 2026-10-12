import { describe, expect, it, vi } from 'vitest';
import { fromBase64Url, toBase64Url } from '../../src/lib/encoding';
import { encryptPayload, isAllowedPushEndpoint, sendPush, vapidAuthorization } from '../../src/server/webpush';

const P256 = { name: 'ECDH', namedCurve: 'P-256' } as const;
const enc = new TextEncoder();

async function hkdf(salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, bytes: number) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

/** Browser-side decryption per RFC 8291, written independently of the implementation. */
async function decryptAsBrowser(body: Uint8Array<ArrayBuffer>, ua: CryptoKeyPair, auth: Uint8Array<ArrayBuffer>) {
  const salt = body.slice(0, 16);
  const idlen = body[20]!;
  const asPublic = body.slice(21, 21 + idlen);
  const ciphertext = body.slice(21 + idlen);
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey));
  const asKey = await crypto.subtle.importKey('raw', asPublic, P256, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256));
  const info = new Uint8Array([...enc.encode('WebPush: info\0'), ...uaPublic, ...asPublic]);
  const ikm = await hkdf(auth, shared, info, 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const padded = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ciphertext));
  expect(padded[padded.length - 1]).toBe(2);
  return new TextDecoder().decode(padded.slice(0, -1));
}

async function browserSubscription() {
  const ua = (await crypto.subtle.generateKey(P256, true, ['deriveBits'])) as CryptoKeyPair;
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const p256dh = toBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey)));
  return { ua, auth, sub: { p256dh, auth: toBase64Url(auth) } };
}

async function vapidKeys() {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const publicKey = toBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
  return { pair, keys: { publicKey, privateKey: jwk.d!, subject: 'mailto:ops@example.com' } };
}

describe('web push encryption (RFC 8291)', () => {
  it('a browser can decrypt the payload with its subscription keys', async () => {
    const { ua, auth, sub } = await browserSubscription();
    const message = JSON.stringify({ title: 'Opened', body: 'Your note was opened', url: '/app' });
    const body = await encryptPayload(sub, enc.encode(message));
    expect(new DataView(body.buffer).getUint32(16)).toBe(4096);
    expect(await decryptAsBrowser(body, ua, auth)).toBe(message);
  });

  it('a different subscription cannot decrypt it', async () => {
    const a = await browserSubscription();
    const b = await browserSubscription();
    const body = await encryptPayload(a.sub, enc.encode('hi'));
    await expect(decryptAsBrowser(body, b.ua, b.auth)).rejects.toThrow();
  });
});

describe('VAPID (RFC 8292)', () => {
  it('signs an ES256 JWT for the push service origin that verifies with the public key', async () => {
    const { pair, keys } = await vapidKeys();
    const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', keys, Date.UTC(2026, 0, 1));
    const [, jwt, k] = header.match(/^vapid t=([^,]+), k=(.+)$/)!;
    expect(k).toBe(keys.publicKey);
    const [h, p, s] = jwt!.split('.');
    const claims = JSON.parse(new TextDecoder().decode(fromBase64Url(p!)));
    expect(claims).toMatchObject({ aud: 'https://fcm.googleapis.com', sub: 'mailto:ops@example.com' });
    expect(claims.exp).toBe(Date.UTC(2026, 0, 1) / 1000 + 12 * 3600);
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      pair.publicKey,
      fromBase64Url(s!),
      enc.encode(`${h}.${p}`),
    );
    expect(ok).toBe(true);
  });
});

describe('sending', () => {
  it('only sends to known push services', async () => {
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com/fcm/send/x')).toBe(true);
    expect(isAllowedPushEndpoint('https://web.push.apple.com/abc')).toBe(true);
    expect(isAllowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(true);
    expect(isAllowedPushEndpoint('http://fcm.googleapis.com/x')).toBe(false);
    expect(isAllowedPushEndpoint('https://169.254.169.254/latest')).toBe(false);
    expect(isAllowedPushEndpoint('https://evil.example/fcm.googleapis.com')).toBe(false);
  });

  it('reports expired subscriptions as gone', async () => {
    const { sub } = await browserSubscription();
    const { keys } = await vapidKeys();
    const fetchImpl = vi.fn(async () => new Response(null, { status: 410 }));
    const result = await sendPush(
      { endpoint: 'https://fcm.googleapis.com/fcm/send/x', ...sub },
      { title: 't', body: 'b', url: '/app' },
      keys,
      Date.now(),
      fetchImpl,
    );
    expect(result).toBe('gone');
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Content-Encoding']).toBe('aes128gcm');
  });
});

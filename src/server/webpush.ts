/**
 * Web Push with Web Crypto only: RFC 8291 message encryption (aes128gcm, RFC 8188) and
 * RFC 8292 VAPID authentication. Payloads are end-to-end encrypted to the browser, so the
 * push service (Google, Mozilla, Apple, Microsoft) can't read them.
 */
import { fromBase64Url, randomBytes, toBase64Url } from '../lib/encoding';

export interface PushSubscriptionKeys {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface VapidKeys {
  publicKey: string; // base64url uncompressed P-256 point (65 bytes)
  privateKey: string; // base64url P-256 scalar (32 bytes)
  subject: string; // mailto: or https: contact
}

/** Push services we're willing to send to; anything else is rejected (no open SSRF). */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^([a-z0-9-]+\.)*push\.apple\.com$/,
  /^([a-z0-9-]+\.)*notify\.windows\.com$/,
];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && PUSH_HOSTS.some((re) => re.test(url.hostname));
  } catch {
    return false;
  }
}

const enc = new TextEncoder();

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

async function hkdf(
  salt: Uint8Array<ArrayBuffer>,
  ikm: Uint8Array<ArrayBuffer>,
  info: Uint8Array<ArrayBuffer>,
  bytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

const P256 = { name: 'ECDH', namedCurve: 'P-256' } as const;

/** Encrypt `payload` for one subscription. Returns the request body (RFC 8188 aes128gcm). */
export async function encryptPayload(
  sub: { p256dh: string; auth: string },
  payload: Uint8Array<ArrayBuffer>,
  // Injectable for tests (RFC 8291 test vectors); random in production.
  options: { serverKeys?: CryptoKeyPair; salt?: Uint8Array<ArrayBuffer> } = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = fromBase64Url(sub.p256dh);
  const authSecret = fromBase64Url(sub.auth);
  const server = options.serverKeys ?? ((await crypto.subtle.generateKey(P256, true, ['deriveBits'])) as CryptoKeyPair);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', server.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, P256, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, server.privateKey, 256));

  const keyInfo = concat(enc.encode('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const salt = options.salt ?? randomBytes(16);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const padded = concat(payload, new Uint8Array([2])); // 0x02 = last record delimiter
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, padded));

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ciphertext);
}

/** RFC 8292 VAPID JWT (ES256) for the push service's origin. */
export async function vapidAuthorization(endpoint: string, vapid: VapidKeys, now: number): Promise<string> {
  const pub = fromBase64Url(vapid.publicKey);
  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    d: vapid.privateKey,
    x: toBase64Url(pub.slice(1, 33)),
    y: toBase64Url(pub.slice(33, 65)),
    ext: true,
  };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const b64json = (value: unknown) => toBase64Url(enc.encode(JSON.stringify(value)));
  const unsigned = `${b64json({ typ: 'JWT', alg: 'ES256' })}.${b64json({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + 12 * 60 * 60,
    sub: vapid.subject,
  })}`;
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(unsigned)));
  return `vapid t=${unsigned}.${toBase64Url(signature)}, k=${vapid.publicKey}`;
}

export interface PushMessage {
  title: string;
  body: string;
  url: string;
}

/**
 * Send one push. Returns 'gone' when the subscription has expired (HTTP 404/410) so the caller
 * can delete it.
 */
export async function sendPush(
  sub: PushSubscriptionKeys,
  message: PushMessage,
  vapid: VapidKeys,
  now: number,
  fetchImpl: typeof fetch = fetch,
): Promise<'ok' | 'gone' | 'failed'> {
  if (!isAllowedPushEndpoint(sub.endpoint)) return 'gone';
  const body = await encryptPayload(sub, enc.encode(JSON.stringify(message)));
  const res = await fetchImpl(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuthorization(sub.endpoint, vapid, now),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(24 * 60 * 60),
      Urgency: 'normal',
    },
    body,
  });
  if (res.status === 404 || res.status === 410) return 'gone';
  return res.ok ? 'ok' : 'failed';
}

/**
 * Client-side encryption. Runs in the browser only; the server never sees the link key,
 * any password, or anything derived from them that would let it decrypt.
 *
 * Notes, without a password:
 *   K = HKDF-SHA256(ikm = linkKey, salt = "", info = "vanishnote/v1/link")
 * With a password:
 *   P = PBKDF2-SHA256(password, salt, 600k iterations, 256 bits)
 *   K = HKDF-SHA256(ikm = linkKey || P, salt = salt, info = "vanishnote/v1/link+password")
 * The note text, and any attachment and its file name, are sealed with AES-256-GCM under K,
 * each with its own random 96-bit IV.
 */
import { fromBase64Url, randomBytes, toBase64Url } from './encoding';
import { IV_BYTES, LINK_KEY_BYTES, MAX_NOTE_BYTES, PBKDF2_ITERATIONS, SALT_BYTES } from './limits';

const INFO_LINK = 'vanishnote/v1/link';
const INFO_LINK_PASSWORD = 'vanishnote/v1/link+password';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  /** Present only for password-protected notes. */
  salt?: string;
}

export interface EncryptResult {
  payload: EncryptedPayload;
  /** base64url link key, to be placed in the URL fragment. */
  linkKey: string;
}

export interface FileMeta {
  name: string;
  type: string;
}

export interface EncryptedFile {
  /** Ciphertext bytes to upload. */
  bytes: Uint8Array<ArrayBuffer>;
  iv: string;
  /** Encrypted JSON {name,type}. */
  meta: string;
  metaIv: string;
}

export class NoteTooLargeError extends Error {
  constructor(readonly bytes: number) {
    super(`Note is ${bytes} bytes; the limit is ${MAX_NOTE_BYTES} bytes`);
    this.name = 'NoteTooLargeError';
  }
}

/** Thrown for a wrong key, wrong password, or tampered ciphertext — deliberately indistinguishable. */
export class DecryptionError extends Error {
  constructor() {
    super('Unable to decrypt');
    this.name = 'DecryptionError';
  }
}

export function utf8ByteLength(text: string): number {
  return encoder.encode(text).byteLength;
}

async function pbkdf2Bits(password: string, salt: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const passwordKey = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
      passwordKey,
      256,
    ),
  );
}

async function hkdfAesKey(
  ikm: Uint8Array<ArrayBuffer>,
  salt: Uint8Array<ArrayBuffer>,
  info: string,
): Promise<CryptoKey> {
  const hkdfKey = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: encoder.encode(info) },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function deriveNoteKey(
  linkKey: Uint8Array<ArrayBuffer>,
  password: string | undefined,
  salt: Uint8Array<ArrayBuffer> | undefined,
): Promise<CryptoKey> {
  if (password === undefined) return hkdfAesKey(linkKey, new Uint8Array(0), INFO_LINK);
  if (!salt) throw new TypeError('A salt is required for password-protected notes');
  return hkdfAesKey(concat(linkKey, await pbkdf2Bits(password, salt)), salt, INFO_LINK_PASSWORD);
}

async function seal(key: CryptoKey, data: Uint8Array<ArrayBuffer>) {
  const iv = randomBytes(IV_BYTES);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data));
  return { ciphertext, iv: toBase64Url(iv) };
}

async function open(key: CryptoKey, ciphertext: Uint8Array<ArrayBuffer>, iv: string): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64Url(iv) }, key, ciphertext));
}

async function sealFile(key: CryptoKey, bytes: Uint8Array<ArrayBuffer>, meta: FileMeta): Promise<EncryptedFile> {
  const file = await seal(key, bytes);
  const sealedMeta = await seal(key, encoder.encode(JSON.stringify({ name: meta.name, type: meta.type })));
  return { bytes: file.ciphertext, iv: file.iv, meta: toBase64Url(sealedMeta.ciphertext), metaIv: sealedMeta.iv };
}

async function openFile(
  key: CryptoKey,
  file: { bytes: Uint8Array<ArrayBuffer>; iv: string; meta: string; metaIv: string },
): Promise<{ bytes: Uint8Array<ArrayBuffer>; meta: FileMeta }> {
  const bytes = await open(key, file.bytes, file.iv);
  const parsed = JSON.parse(decoder.decode(await open(key, fromBase64Url(file.meta), file.metaIv))) as Partial<FileMeta>;
  return {
    bytes,
    meta: { name: String(parsed.name ?? 'attachment'), type: String(parsed.type ?? 'application/octet-stream') },
  };
}

/** Everything needed to encrypt a note and its optional attachment under one key. */
export interface SealedNote extends EncryptResult {
  file?: EncryptedFile;
}

export async function encryptNote(plaintext: string, password?: string): Promise<EncryptResult> {
  const { payload, linkKey } = await sealNote(plaintext, password);
  return { payload, linkKey };
}

export async function sealNote(
  plaintext: string,
  password?: string,
  file?: { bytes: Uint8Array<ArrayBuffer>; meta: FileMeta },
): Promise<SealedNote> {
  const data = encoder.encode(plaintext);
  if (data.byteLength > MAX_NOTE_BYTES) throw new NoteTooLargeError(data.byteLength);

  const usePassword = password !== undefined && password !== '';
  const linkKey = randomBytes(LINK_KEY_BYTES);
  const salt = usePassword ? randomBytes(SALT_BYTES) : undefined;
  const key = await deriveNoteKey(linkKey, usePassword ? password : undefined, salt);

  const text = await seal(key, data);
  const payload: EncryptedPayload = { ciphertext: toBase64Url(text.ciphertext), iv: text.iv };
  if (salt) payload.salt = toBase64Url(salt);
  const result: SealedNote = { payload, linkKey: toBase64Url(linkKey) };
  if (file) result.file = await sealFile(key, file.bytes, file.meta);
  return result;
}

async function noteKeyFor(payload: EncryptedPayload, linkKey: string, password?: string): Promise<CryptoKey> {
  const keyBytes = fromBase64Url(linkKey);
  if (keyBytes.length !== LINK_KEY_BYTES) throw new DecryptionError();
  const salt = payload.salt === undefined ? undefined : fromBase64Url(payload.salt);
  // A salt means the note was sealed with a password; ignore any password otherwise.
  return deriveNoteKey(keyBytes, salt ? (password ?? '') : undefined, salt);
}

export async function decryptNote(payload: EncryptedPayload, linkKey: string, password?: string): Promise<string> {
  try {
    const key = await noteKeyFor(payload, linkKey, password);
    return decoder.decode(await open(key, fromBase64Url(payload.ciphertext), payload.iv));
  } catch {
    throw new DecryptionError();
  }
}

/** Decrypt a note's attachment with the same link key and password as its text. */
export async function decryptNoteFile(
  payload: EncryptedPayload,
  linkKey: string,
  password: string | undefined,
  file: { bytes: Uint8Array<ArrayBuffer>; iv: string; meta: string; metaIv: string },
): Promise<{ bytes: Uint8Array<ArrayBuffer>; meta: FileMeta }> {
  try {
    return await openFile(await noteKeyFor(payload, linkKey, password), file);
  } catch {
    throw new DecryptionError();
  }
}

/** Decrypt only the attachment's name and type (before downloading it). */
export async function decryptNoteFileMeta(
  payload: EncryptedPayload,
  linkKey: string,
  password: string | undefined,
  meta: string,
  metaIv: string,
): Promise<FileMeta> {
  try {
    const key = await noteKeyFor(payload, linkKey, password);
    const parsed = JSON.parse(decoder.decode(await open(key, fromBase64Url(meta), metaIv))) as Partial<FileMeta>;
    return { name: String(parsed.name ?? 'attachment'), type: String(parsed.type ?? 'application/octet-stream') };
  } catch {
    throw new DecryptionError();
  }
}

/** True if `fragment` looks like a well-formed link key. */
export function isLinkKey(fragment: string): boolean {
  try {
    return fromBase64Url(fragment).length === LINK_KEY_BYTES;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// Login. The server never receives the password: it gets an auth key derived from it.
//   M = PBKDF2-SHA256(password, salt = SHA-256("vanishnote/v1/login:" + email), 600k)
//   authKey = HKDF-SHA256(M, info = "vanishnote/v1/auth")
// ---------------------------------------------------------------------------------------------

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function deriveAuthKey(email: string, password: string): Promise<string> {
  const salt = new Uint8Array(
    await crypto.subtle.digest('SHA-256', encoder.encode(`vanishnote/v1/login:${normalizeEmail(email)}`)),
  );
  const master = await pbkdf2Bits(password, salt);
  const hkdfKey = await crypto.subtle.importKey('raw', master, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: encoder.encode('vanishnote/v1/auth') },
    hkdfKey,
    256,
  );
  return toBase64Url(new Uint8Array(bits));
}

// ---------------------------------------------------------------------------------------------
// Information requests (ECIES-style). The requester's browser makes an ECDH P-256 key pair and
// wraps the private key with a key derived from the request password. The responder's browser
// encrypts to the public key with a fresh ephemeral key pair:
//   S = ECDH(ephemeral, requestPublic);  K = HKDF-SHA256(S, salt = epk || pk, info = "vanishnote/v1/request")
// The request link carries SHA-256(publicKey) in its fragment, so the responder can detect a
// swapped public key.
// ---------------------------------------------------------------------------------------------

const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;
const INFO_REQUEST = 'vanishnote/v1/request';
const INFO_REQUEST_WRAP = 'vanishnote/v1/request-wrap';

export interface RequestKeys {
  publicKey: string;
  wrappedKey: string;
  wrappedKeyIv: string;
  wrappedKeySalt: string;
  /** Goes in the request link's fragment. */
  fingerprint: string;
}

export async function publicKeyFingerprint(publicKey: string): Promise<string> {
  return toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', fromBase64Url(publicKey))));
}

async function requestWrapKey(password: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return hkdfAesKey(await pbkdf2Bits(password, salt), salt, INFO_REQUEST_WRAP);
}

export async function createRequestKeys(password: string): Promise<RequestKeys> {
  const pair = (await crypto.subtle.generateKey(ECDH, true, ['deriveBits'])) as CryptoKeyPair;
  const publicKey = toBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const salt = randomBytes(SALT_BYTES);
  const wrapped = await seal(await requestWrapKey(password, salt), pkcs8);
  return {
    publicKey,
    wrappedKey: toBase64Url(wrapped.ciphertext),
    wrappedKeyIv: wrapped.iv,
    wrappedKeySalt: toBase64Url(salt),
    fingerprint: await publicKeyFingerprint(publicKey),
  };
}

async function requestKey(
  privateKey: CryptoKey,
  peerPublic: string,
  epk: string,
  pk: string,
): Promise<CryptoKey> {
  const peer = await crypto.subtle.importKey('raw', fromBase64Url(peerPublic), ECDH, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, privateKey, 256));
  return hkdfAesKey(shared, concat(fromBase64Url(epk), fromBase64Url(pk)), INFO_REQUEST);
}

export interface RequestResponse {
  response: string;
  responseIv: string;
  epk: string;
  file?: EncryptedFile;
}

/** Responder side: encrypt text (and an optional file) to the request's public key. */
export async function sealForRequest(
  publicKey: string,
  fingerprint: string,
  text: string,
  file?: { bytes: Uint8Array<ArrayBuffer>; meta: FileMeta },
): Promise<RequestResponse> {
  if ((await publicKeyFingerprint(publicKey)) !== fingerprint) throw new DecryptionError();
  const data = encoder.encode(text);
  if (data.byteLength > MAX_NOTE_BYTES) throw new NoteTooLargeError(data.byteLength);
  const ephemeral = (await crypto.subtle.generateKey(ECDH, true, ['deriveBits'])) as CryptoKeyPair;
  const epk = toBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey)));
  const key = await requestKey(ephemeral.privateKey, publicKey, epk, publicKey);
  const sealed = await seal(key, data);
  const out: RequestResponse = { response: toBase64Url(sealed.ciphertext), responseIv: sealed.iv, epk };
  if (file) out.file = await sealFile(key, file.bytes, file.meta);
  return out;
}

export interface WrappedRequestKey {
  publicKey: string;
  wrappedKey: string;
  wrappedKeyIv: string;
  wrappedKeySalt: string;
}

/**
 * Requester side, step 1: unlock the private key with the request password. Done before the
 * response is fetched (and shredded), so a mistyped password never costs the response.
 */
export async function unlockRequestKey(keys: WrappedRequestKey, password: string): Promise<CryptoKey> {
  try {
    const salt = fromBase64Url(keys.wrappedKeySalt);
    const pkcs8 = await open(await requestWrapKey(password, salt), fromBase64Url(keys.wrappedKey), keys.wrappedKeyIv);
    return await crypto.subtle.importKey('pkcs8', pkcs8, ECDH, false, ['deriveBits']);
  } catch {
    throw new DecryptionError();
  }
}

/** Requester side, step 2: the response key for a responder's ephemeral public key. */
export async function responseKey(privateKey: CryptoKey, publicKey: string, epk: string): Promise<CryptoKey> {
  try {
    return await requestKey(privateKey, epk, epk, publicKey);
  } catch {
    throw new DecryptionError();
  }
}

/** Both steps at once. */
export async function openRequestKey(keys: WrappedRequestKey, password: string, epk: string): Promise<CryptoKey> {
  return responseKey(await unlockRequestKey(keys, password), keys.publicKey, epk);
}

export async function openRequestText(key: CryptoKey, response: string, responseIv: string): Promise<string> {
  try {
    return decoder.decode(await open(key, fromBase64Url(response), responseIv));
  } catch {
    throw new DecryptionError();
  }
}

export async function openRequestFile(
  key: CryptoKey,
  file: { bytes: Uint8Array<ArrayBuffer>; iv: string; meta: string; metaIv: string },
): Promise<{ bytes: Uint8Array<ArrayBuffer>; meta: FileMeta }> {
  try {
    return await openFile(key, file);
  } catch {
    throw new DecryptionError();
  }
}

export async function openRequestFileMeta(key: CryptoKey, meta: string, metaIv: string): Promise<FileMeta> {
  try {
    const parsed = JSON.parse(decoder.decode(await open(key, fromBase64Url(meta), metaIv))) as Partial<FileMeta>;
    return { name: String(parsed.name ?? 'attachment'), type: String(parsed.type ?? 'application/octet-stream') };
  } catch {
    throw new DecryptionError();
  }
}

/** Letters and digits without look-alikes (I O l o 0 1), plus symbols most sites accept. */
export const DEFAULT_PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789-_!@#%';

/** A strong random password: by default 20 chars from an unambiguous alphabet. */
export function generatePassword(length = 20, alphabet = DEFAULT_PASSWORD_ALPHABET): string {
  if (alphabet.length < 2 || alphabet.length > 256) throw new RangeError('The alphabet needs 2 to 256 characters');
  const out: string[] = [];
  // Rejection sampling to avoid modulo bias.
  const limit = 256 - (256 % alphabet.length);
  while (out.length < length) {
    for (const b of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (b < limit && out.length < length) out.push(alphabet[b % alphabet.length]!);
    }
  }
  return out.join('');
}

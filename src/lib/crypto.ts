/**
 * Client-side note encryption. Runs in the browser only; the server never sees
 * the link key, the password, or anything derived from them.
 *
 * Without a password:
 *   K = HKDF-SHA256(ikm = linkKey, salt = "", info = "vanishnote/v1/link")
 * With a password:
 *   P = PBKDF2-SHA256(password, salt, 600k iterations, 256 bits)
 *   K = HKDF-SHA256(ikm = linkKey || P, salt = salt, info = "vanishnote/v1/link+password")
 * The note is sealed once with AES-256-GCM under K and a random 96-bit IV.
 * Recovering K requires both the URL fragment and the password.
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

export class NoteTooLargeError extends Error {
  constructor(readonly bytes: number) {
    super(`Note is ${bytes} bytes; the limit is ${MAX_NOTE_BYTES} bytes`);
    this.name = 'NoteTooLargeError';
  }
}

/** Thrown for a wrong key, wrong password, or tampered ciphertext — deliberately indistinguishable. */
export class DecryptionError extends Error {
  constructor() {
    super('Unable to decrypt note');
    this.name = 'DecryptionError';
  }
}

export function utf8ByteLength(text: string): number {
  return encoder.encode(text).byteLength;
}

async function deriveNoteKey(
  linkKey: Uint8Array<ArrayBuffer>,
  password: string | undefined,
  salt: Uint8Array<ArrayBuffer> | undefined,
): Promise<CryptoKey> {
  let ikm: Uint8Array<ArrayBuffer> = linkKey;
  let hkdfSalt: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  let info = INFO_LINK;

  if (password !== undefined) {
    if (!salt) throw new TypeError('A salt is required for password-protected notes');
    const passwordKey = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
      'deriveBits',
    ]);
    const passwordBits = new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
        passwordKey,
        256,
      ),
    );
    ikm = new Uint8Array(linkKey.length + passwordBits.length);
    ikm.set(linkKey, 0);
    ikm.set(passwordBits, linkKey.length);
    hkdfSalt = salt;
    info = INFO_LINK_PASSWORD;
  }

  const hkdfKey = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: hkdfSalt, info: encoder.encode(info) },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptNote(plaintext: string, password?: string): Promise<EncryptResult> {
  const data = encoder.encode(plaintext);
  if (data.byteLength > MAX_NOTE_BYTES) throw new NoteTooLargeError(data.byteLength);

  const usePassword = password !== undefined && password !== '';
  const linkKey = randomBytes(LINK_KEY_BYTES);
  const iv = randomBytes(IV_BYTES);
  const salt = usePassword ? randomBytes(SALT_BYTES) : undefined;

  const key = await deriveNoteKey(linkKey, usePassword ? password : undefined, salt);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data));

  const payload: EncryptedPayload = { ciphertext: toBase64Url(ciphertext), iv: toBase64Url(iv) };
  if (salt) payload.salt = toBase64Url(salt);
  return { payload, linkKey: toBase64Url(linkKey) };
}

export async function decryptNote(
  payload: EncryptedPayload,
  linkKey: string,
  password?: string,
): Promise<string> {
  try {
    const keyBytes = fromBase64Url(linkKey);
    if (keyBytes.length !== LINK_KEY_BYTES) throw new DecryptionError();
    const salt = payload.salt === undefined ? undefined : fromBase64Url(payload.salt);
    // A salt means the note was sealed with a password; ignore any password otherwise.
    const key = await deriveNoteKey(keyBytes, salt ? (password ?? '') : undefined, salt);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64Url(payload.iv) },
      key,
      fromBase64Url(payload.ciphertext),
    );
    return decoder.decode(plaintext);
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

import { describe, expect, it } from 'vitest';
import {
  DecryptionError,
  NoteTooLargeError,
  decryptNote,
  encryptNote,
  isLinkKey,
  utf8ByteLength,
} from '../../src/lib/crypto';
import { fromBase64Url, toBase64Url } from '../../src/lib/encoding';
import { IV_BYTES, LINK_KEY_BYTES, MAX_NOTE_BYTES, SALT_BYTES } from '../../src/lib/limits';

const sample = 'The vault code is 4-8-15-16-23-42 🔐 — ünïcødé ok';

function flipLastChar(b64: string): string {
  const bytes = fromBase64Url(b64);
  bytes[bytes.length - 1]! ^= 0x01;
  return toBase64Url(bytes);
}

describe('base64url', () => {
  it('round-trips arbitrary bytes', () => {
    for (const len of [0, 1, 2, 3, 15, 16, 17, 32, 255]) {
      const bytes = crypto.getRandomValues(new Uint8Array(len));
      const encoded = toBase64Url(bytes);
      expect(encoded).toMatch(/^[A-Za-z0-9_-]*$/);
      expect(fromBase64Url(encoded)).toEqual(bytes);
    }
  });

  it('rejects non-base64url input', () => {
    expect(() => fromBase64Url('abc+')).toThrow();
    expect(() => fromBase64Url('abc=')).toThrow();
    expect(() => fromBase64Url('a')).toThrow();
  });
});

describe('note crypto without password', () => {
  it('round-trips', async () => {
    const { payload, linkKey } = await encryptNote(sample);
    expect(payload.salt).toBeUndefined();
    expect(await decryptNote(payload, linkKey)).toBe(sample);
  });

  it('uses a fresh 256-bit key and 96-bit IV every time', async () => {
    const a = await encryptNote(sample);
    const b = await encryptNote(sample);
    expect(fromBase64Url(a.linkKey)).toHaveLength(LINK_KEY_BYTES);
    expect(fromBase64Url(a.payload.iv)).toHaveLength(IV_BYTES);
    expect(a.linkKey).not.toBe(b.linkKey);
    expect(a.payload.iv).not.toBe(b.payload.iv);
    expect(a.payload.ciphertext).not.toBe(b.payload.ciphertext);
  });

  it('never puts plaintext or key material in the payload', async () => {
    const { payload, linkKey } = await encryptNote(sample);
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('vault');
    expect(serialized).not.toContain(linkKey);
  });

  it('fails with the wrong link key', async () => {
    const { payload } = await encryptNote(sample);
    const other = await encryptNote(sample);
    await expect(decryptNote(payload, other.linkKey)).rejects.toBeInstanceOf(DecryptionError);
  });

  it('detects tampered ciphertext and IV', async () => {
    const { payload, linkKey } = await encryptNote(sample);
    await expect(
      decryptNote({ ...payload, ciphertext: flipLastChar(payload.ciphertext) }, linkKey),
    ).rejects.toBeInstanceOf(DecryptionError);
    await expect(decryptNote({ ...payload, iv: flipLastChar(payload.iv) }, linkKey)).rejects.toBeInstanceOf(
      DecryptionError,
    );
  });

  it('rejects malformed keys as a decryption error', async () => {
    const { payload } = await encryptNote(sample);
    await expect(decryptNote(payload, 'not a key!')).rejects.toBeInstanceOf(DecryptionError);
    await expect(decryptNote(payload, toBase64Url(new Uint8Array(16)))).rejects.toBeInstanceOf(
      DecryptionError,
    );
  });

  it('handles an exactly-50KB note and rejects anything larger', async () => {
    const max = 'a'.repeat(MAX_NOTE_BYTES);
    const { payload, linkKey } = await encryptNote(max);
    expect(await decryptNote(payload, linkKey)).toBe(max);

    await expect(encryptNote(max + 'a')).rejects.toBeInstanceOf(NoteTooLargeError);
    // Multi-byte characters count by UTF-8 bytes, not string length.
    const emoji = '🔐'.repeat(MAX_NOTE_BYTES / 4 + 1);
    expect(utf8ByteLength(emoji)).toBeGreaterThan(MAX_NOTE_BYTES);
    await expect(encryptNote(emoji)).rejects.toBeInstanceOf(NoteTooLargeError);
  });
});

describe('note crypto with password', () => {
  const password = 'correct horse battery staple';

  it('round-trips with the right password', async () => {
    const { payload, linkKey } = await encryptNote(sample, password);
    expect(payload.salt).toBeDefined();
    expect(fromBase64Url(payload.salt!)).toHaveLength(SALT_BYTES);
    expect(await decryptNote(payload, linkKey, password)).toBe(sample);
  });

  it('fails with a wrong or missing password', async () => {
    const { payload, linkKey } = await encryptNote(sample, password);
    await expect(decryptNote(payload, linkKey, 'Correct horse battery staple')).rejects.toBeInstanceOf(
      DecryptionError,
    );
    await expect(decryptNote(payload, linkKey)).rejects.toBeInstanceOf(DecryptionError);
  });

  it('requires the link key as well as the password', async () => {
    const { payload } = await encryptNote(sample, password);
    const other = await encryptNote(sample, password);
    await expect(decryptNote(payload, other.linkKey, password)).rejects.toBeInstanceOf(DecryptionError);
  });

  it('fails if the salt is altered or stripped', async () => {
    const { payload, linkKey } = await encryptNote(sample, password);
    await expect(
      decryptNote({ ...payload, salt: flipLastChar(payload.salt!) }, linkKey, password),
    ).rejects.toBeInstanceOf(DecryptionError);
    const { salt: _salt, ...withoutSalt } = payload;
    await expect(decryptNote(withoutSalt, linkKey, password)).rejects.toBeInstanceOf(DecryptionError);
  });

  it('treats an empty password as no password', async () => {
    const { payload, linkKey } = await encryptNote(sample, '');
    expect(payload.salt).toBeUndefined();
    expect(await decryptNote(payload, linkKey)).toBe(sample);
  });
});

describe('isLinkKey', () => {
  it('accepts only 32-byte base64url keys', async () => {
    const { linkKey } = await encryptNote('x');
    expect(isLinkKey(linkKey)).toBe(true);
    expect(isLinkKey('')).toBe(false);
    expect(isLinkKey(linkKey.slice(0, -1))).toBe(false);
    expect(isLinkKey(`${linkKey}%20`)).toBe(false);
  });
});

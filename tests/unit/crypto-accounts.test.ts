import { describe, expect, it } from 'vitest';
import {
  DecryptionError,
  createRequestKeys,
  decryptNote,
  decryptNoteFile,
  decryptNoteFileMeta,
  deriveAuthKey,
  generatePassword,
  openRequestFile,
  openRequestKey,
  openRequestText,
  sealForRequest,
  sealNote,
} from '../../src/lib/crypto';
import { fromBase64Url } from '../../src/lib/encoding';

const fileBytes = () => crypto.getRandomValues(new Uint8Array(4096));
const meta = { name: 'contract (final).pdf', type: 'application/pdf' };

describe('note attachments', () => {
  it('seal text and file under one key; both open with the link key and password', async () => {
    const bytes = fileBytes();
    const sealed = await sealNote('see attached', 'pw', { bytes, meta });
    expect(sealed.file!.bytes).not.toEqual(bytes);
    expect(sealed.file!.bytes.length).toBe(bytes.length + 16);
    expect(await decryptNote(sealed.payload, sealed.linkKey, 'pw')).toBe('see attached');

    const file = { ...sealed.file! };
    expect(await decryptNoteFileMeta(sealed.payload, sealed.linkKey, 'pw', file.meta, file.metaIv)).toEqual(meta);
    const opened = await decryptNoteFile(sealed.payload, sealed.linkKey, 'pw', file);
    expect(opened.bytes).toEqual(bytes);
    expect(opened.meta).toEqual(meta);
  });

  it('the file name is encrypted, and a wrong password cannot open the file', async () => {
    const sealed = await sealNote('x', 'pw', { bytes: fileBytes(), meta });
    expect(new TextDecoder().decode(fromBase64Url(sealed.file!.meta))).not.toContain('contract');
    await expect(decryptNoteFile(sealed.payload, sealed.linkKey, 'nope', sealed.file!)).rejects.toBeInstanceOf(
      DecryptionError,
    );
  });
});

describe('login auth key', () => {
  it('is deterministic per email+password, case-insensitive on email', async () => {
    const a = await deriveAuthKey('Jane@Example.com ', 'correct horse');
    const b = await deriveAuthKey('jane@example.com', 'correct horse');
    expect(a).toBe(b);
    expect(fromBase64Url(a)).toHaveLength(32);
  });

  it('differs for another password or another email, and never contains the password', async () => {
    const base = await deriveAuthKey('jane@example.com', 'correct horse');
    expect(await deriveAuthKey('jane@example.com', 'correct horse!')).not.toBe(base);
    expect(await deriveAuthKey('john@example.com', 'correct horse')).not.toBe(base);
    expect(base).not.toContain('horse');
  });
});

describe('information requests', () => {
  it('responder encrypts to the public key; requester opens with the request password', async () => {
    const keys = await createRequestKeys('request-pw');
    const bytes = fileBytes();
    const response = await sealForRequest(keys.publicKey, keys.fingerprint, 'my passport number is X', { bytes, meta });

    const key = await openRequestKey(keys, 'request-pw', response.epk);
    expect(await openRequestText(key, response.response, response.responseIv)).toBe('my passport number is X');
    const file = await openRequestFile(key, response.file!);
    expect(file.bytes).toEqual(bytes);
    expect(file.meta).toEqual(meta);
  });

  it('the wrong request password cannot unlock the private key', async () => {
    const keys = await createRequestKeys('request-pw');
    const response = await sealForRequest(keys.publicKey, keys.fingerprint, 'secret');
    await expect(openRequestKey(keys, 'wrong', response.epk)).rejects.toBeInstanceOf(DecryptionError);
  });

  it('refuses to encrypt to a public key that does not match the link fingerprint', async () => {
    const real = await createRequestKeys('a');
    const attacker = await createRequestKeys('b');
    await expect(sealForRequest(attacker.publicKey, real.fingerprint, 'secret')).rejects.toBeInstanceOf(
      DecryptionError,
    );
  });

  it('another request key pair cannot read the response', async () => {
    const keys = await createRequestKeys('pw');
    const other = await createRequestKeys('pw');
    const response = await sealForRequest(keys.publicKey, keys.fingerprint, 'secret');
    const wrongKey = await openRequestKey(other, 'pw', response.epk);
    await expect(openRequestText(wrongKey, response.response, response.responseIv)).rejects.toBeInstanceOf(
      DecryptionError,
    );
  });
});

describe('password generator', () => {
  it('makes long, varied passwords', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const pw = generatePassword();
      expect(pw).toHaveLength(20);
      expect(pw).not.toMatch(/[0OIl1]/);
      seen.add(pw);
    }
    expect(seen.size).toBe(50);
  });
});

// base64url (RFC 4648 §5) without padding. Shared by browser and Worker code.

const BASE64URL_RE = /^[A-Za-z0-9_-]*$/;

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(input: string): Uint8Array<ArrayBuffer> {
  if (!BASE64URL_RE.test(input) || input.length % 4 === 1) {
    throw new TypeError('Invalid base64url string');
  }
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Length of the unpadded base64url encoding of `byteLength` bytes. */
export function base64UrlLength(byteLength: number): number {
  return Math.ceil((byteLength * 4) / 3);
}

export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length));
}

import { base64UrlLength } from './encoding';

/** Maximum plaintext size, measured in UTF-8 bytes. */
export const MAX_NOTE_BYTES = 50 * 1024;

/** AES-GCM appends a 16-byte authentication tag. */
export const GCM_TAG_BYTES = 16;
export const MAX_CIPHERTEXT_CHARS = base64UrlLength(MAX_NOTE_BYTES + GCM_TAG_BYTES);

export const LINK_KEY_BYTES = 32; // AES-256
export const IV_BYTES = 12; // 96-bit GCM nonce
export const SALT_BYTES = 16;
export const NOTE_ID_BYTES = 16; // 128 bits
export const DELETE_TOKEN_BYTES = 32;

export const NOTE_ID_RE = new RegExp(`^[A-Za-z0-9_-]{${base64UrlLength(NOTE_ID_BYTES)}}$`);
export const DELETE_TOKEN_RE = new RegExp(`^[A-Za-z0-9_-]{${base64UrlLength(DELETE_TOKEN_BYTES)}}$`);

export const PBKDF2_ITERATIONS = 600_000;

export const EXPIRY_SECONDS = {
  '1h': 60 * 60,
  '1d': 24 * 60 * 60,
  '7d': 7 * 24 * 60 * 60,
  '30d': 30 * 24 * 60 * 60,
} as const;
export type ExpiryOption = keyof typeof EXPIRY_SECONDS;
export const DEFAULT_EXPIRY: ExpiryOption = '7d';

/** "Shred after a set time" choices for account notes, capped by the plan's retention. */
export const TIMED_EXPIRY_DAYS = {
  '1h': 1 / 24,
  '1d': 1,
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '180d': 180,
  '365d': 365,
} as const;
export type TimedExpiry = keyof typeof TIMED_EXPIRY_DAYS;
export const TIMED_EXPIRY_LABELS: Record<TimedExpiry, string> = {
  '1h': '1 hour',
  '1d': '1 day',
  '7d': '7 days',
  '30d': '30 days',
  '90d': '3 months',
  '180d': '6 months',
  '365d': '12 months',
};

/** Encrypted file names/types are tiny; this caps the encrypted metadata field. */
export const MAX_FILE_META_CHARS = 2048;
export const MAX_TITLE_CHARS = 120;
export const MAX_HINT_CHARS = 200;
export const MAX_MESSAGE_CHARS = 2000;

export const MIN_READS = 1;
export const MAX_READS = 10;

/** Upper bound on any request body we are willing to read. */
export const MAX_REQUEST_BYTES = 128 * 1024;

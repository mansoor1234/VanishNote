import { z } from 'zod';
import { base64UrlLength } from './encoding';
import {
  DEFAULT_EXPIRY,
  DELETE_TOKEN_RE,
  EXPIRY_SECONDS,
  GCM_TAG_BYTES,
  IV_BYTES,
  MAX_CIPHERTEXT_CHARS,
  MAX_READS,
  MIN_READS,
  SALT_BYTES,
} from './limits';

const b64url = (length: number) => z.string().regex(new RegExp(`^[A-Za-z0-9_-]{${length}}$`));

export const expirySchema = z.enum(Object.keys(EXPIRY_SECONDS) as [keyof typeof EXPIRY_SECONDS]);

export const createNoteSchema = z.strictObject({
  ciphertext: z
    .string()
    .min(base64UrlLength(GCM_TAG_BYTES + 1))
    .max(MAX_CIPHERTEXT_CHARS)
    .regex(/^[A-Za-z0-9_-]+$/),
  iv: b64url(base64UrlLength(IV_BYTES)),
  salt: b64url(base64UrlLength(SALT_BYTES)).optional(),
  options: z
    .strictObject({
      expiresIn: expirySchema.default(DEFAULT_EXPIRY),
      maxReads: z.number().int().min(MIN_READS).max(MAX_READS).default(MIN_READS),
      notifyEmail: z.email().max(254).optional(),
    })
    .default({ expiresIn: DEFAULT_EXPIRY, maxReads: MIN_READS }),
});
export type CreateNoteInput = z.infer<typeof createNoteSchema>;

export const deleteNoteSchema = z.strictObject({
  deleteToken: z.string().regex(DELETE_TOKEN_RE),
});

export interface CreateNoteResponse {
  id: string;
  deleteToken: string;
  expiresAt: number;
}

export interface ReadNoteResponse {
  ciphertext: string;
  iv: string;
  salt?: string;
  hasPassword: boolean;
  /** Reads remaining after this one; 0 means the note has been destroyed. */
  readsLeft: number;
}

export interface ErrorResponse {
  error: string;
  message: string;
}

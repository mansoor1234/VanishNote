/**
 * Framework-agnostic API handlers. The Astro endpoints in src/pages/api are thin wrappers
 * that supply real bindings; tests call these directly against a local D1.
 */
import { randomBytes, toBase64Url } from '../lib/encoding';
import { DELETE_TOKEN_BYTES, EXPIRY_SECONDS, MAX_REQUEST_BYTES, NOTE_ID_BYTES, NOTE_ID_RE } from '../lib/limits';
import {
  createNoteSchema,
  deleteNoteSchema,
  type CreateNoteResponse,
  type ReadNoteResponse,
} from '../lib/schema';
import { consumeNote, deleteNoteWithToken, insertNote, type ConsumedNote } from './db';
import type { Notifier } from './email';
import { BodyError, error, json, noContent, notFound, readJson, sha256Hex, tooManyRequests } from './http';

export interface Limiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface ApiDeps {
  db: D1Database;
  now?: () => number;
  createLimiter?: Limiter;
  readLimiter?: Limiter;
  notify?: Notifier;
  waitUntil?: (promise: Promise<unknown>) => void;
  /** Called after an account (team) note is read: records activity, notifies the sender, issues file grants. */
  onAccountRead?: (id: string, note: ConsumedNote, now: number) => Promise<{ downloadToken?: string }>;
}

function clientKey(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? 'unknown';
}

async function allowed(limiter: Limiter | undefined, request: Request): Promise<boolean> {
  if (!limiter) return true;
  const { success } = await limiter.limit({ key: clientKey(request) });
  return success;
}

function bodyErrorResponse(err: unknown): Response {
  if (err instanceof BodyError) return error(err.status, err.code, err.message);
  throw err;
}

export async function handleCreateNote(request: Request, deps: ApiDeps): Promise<Response> {
  if (!(await allowed(deps.createLimiter, request))) return tooManyRequests();

  let body: unknown;
  try {
    body = await readJson(request, MAX_REQUEST_BYTES);
  } catch (err) {
    return bodyErrorResponse(err);
  }

  const parsed = createNoteSchema.safeParse(body);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.') || '(root)'))];
    return error(400, 'invalid_request', `Invalid or missing fields: ${fields.join(', ')}.`);
  }

  const { ciphertext, iv, salt, options } = parsed.data;
  const now = deps.now?.() ?? Date.now();
  const id = toBase64Url(randomBytes(NOTE_ID_BYTES));
  const deleteToken = toBase64Url(randomBytes(DELETE_TOKEN_BYTES));
  const expiresAt = now + EXPIRY_SECONDS[options.expiresIn] * 1000;

  await insertNote(deps.db, {
    id,
    ciphertext,
    iv,
    salt: salt ?? null,
    readsLeft: options.maxReads,
    expiresAt,
    notifyEmail: options.notifyEmail ?? null,
    deleteTokenHash: await sha256Hex(deleteToken),
    createdAt: now,
  });

  const response: CreateNoteResponse = { id, deleteToken, expiresAt };
  return json(response, 201);
}

export async function handleReadNote(request: Request, id: string, deps: ApiDeps): Promise<Response> {
  if (!(await allowed(deps.readLimiter, request))) return tooManyRequests();
  if (!NOTE_ID_RE.test(id)) return notFound();

  const now = deps.now?.() ?? Date.now();
  const note = await consumeNote(deps.db, id, now);
  if (!note) return notFound();

  if (note.notify_email && deps.notify) {
    const sending = deps
      .notify({ to: note.notify_email, readAt: now, readsLeft: note.reads_left })
      .catch((err: unknown) => {
        console.error('read notification failed:', err instanceof Error ? err.message : 'unknown error');
      });
    if (deps.waitUntil) deps.waitUntil(sending);
    else await sending;
  }

  const response: ReadNoteResponse = {
    ciphertext: note.ciphertext,
    iv: note.iv,
    hasPassword: note.has_password === 1,
    readsLeft: note.reads_left,
  };
  if (note.salt) response.salt = note.salt;
  if (note.reads_left < 0) response.expiresAt = note.expires_at;
  if (note.password_hint) response.passwordHint = note.password_hint;

  if (note.team_id && deps.onAccountRead) {
    const { downloadToken } = await deps.onAccountRead(id, note, now);
    if (downloadToken && note.file_key && note.file_iv && note.file_meta && note.file_meta_iv) {
      response.file = {
        size: note.file_size ?? 0,
        iv: note.file_iv,
        meta: note.file_meta,
        metaIv: note.file_meta_iv,
        downloadToken,
      };
    }
  }
  return json(response);
}

export async function handleDeleteNote(request: Request, id: string, deps: ApiDeps): Promise<Response> {
  if (!(await allowed(deps.readLimiter, request))) return tooManyRequests();

  let body: unknown;
  try {
    body = await readJson(request, 1024);
  } catch (err) {
    return bodyErrorResponse(err);
  }
  const parsed = deleteNoteSchema.safeParse(body);
  if (!parsed.success || !NOTE_ID_RE.test(id)) return notFound();

  const deleted = await deleteNoteWithToken(deps.db, id, await sha256Hex(parsed.data.deleteToken), deps.now?.() ?? Date.now());
  return deleted ? noContent() : notFound();
}

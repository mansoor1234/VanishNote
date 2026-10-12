import type { EncryptedPayload } from '../lib/crypto';
import type { CreateNoteResponse, ErrorResponse, ReadNoteResponse } from '../lib/schema';
import type { ExpiryOption } from '../lib/limits';

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; message: string; retryAfter?: number };

const NETWORK_ERROR = "We couldn't reach Vanishnote. Check your connection and try again.";

async function call<T>(path: string, init: RequestInit): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
  } catch {
    return { ok: false, status: 0, message: NETWORK_ERROR };
  }
  if (response.status === 204) return { ok: true, data: undefined as T };
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // fall through with a generic message
  }
  if (response.ok) return { ok: true, data: body as T };
  const message = (body as ErrorResponse | null)?.message ?? 'Something went wrong. Please try again.';
  const retryAfter = Number(response.headers.get('Retry-After'));
  return {
    ok: false,
    status: response.status,
    message,
    ...(retryAfter > 0 ? { retryAfter } : {}),
  };
}

export interface CreateOptions {
  expiresIn: ExpiryOption;
  maxReads: number;
  notifyEmail?: string;
}

export function createNote(payload: EncryptedPayload, options: CreateOptions) {
  return call<CreateNoteResponse>('/api/notes', {
    method: 'POST',
    body: JSON.stringify({ ...payload, options }),
  });
}

export function readNote(id: string) {
  return call<ReadNoteResponse>(`/api/notes/${encodeURIComponent(id)}/read`, { method: 'POST', body: '{}' });
}

export function destroyNote(id: string, deleteToken: string) {
  return call<void>(`/api/notes/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    body: JSON.stringify({ deleteToken }),
  });
}

/** The note ID is the last path segment of /n/:id or /d/:id. */
export function idFromPath(): string {
  return decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() ?? '');
}

/** The fragment without its leading "#". */
export function fragment(): string {
  return location.hash.replace(/^#/, '');
}

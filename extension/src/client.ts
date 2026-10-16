/**
 * What the extension sends to Vanishnote. The note is encrypted here, in the extension, with the
 * same code as the website (src/lib/crypto.ts); only ciphertext leaves the browser. The key goes
 * into the link's fragment and never reaches the server.
 *
 * - No API key: a quick note, exactly like the home page (no account, 1 hour to 7 days).
 * - With an API key: the note goes into the user's dashboard, and the team's policies apply
 *   (the server enforces them; the form reads them from /api/account/policy).
 */
import { sealNote, utf8ByteLength } from '../../src/lib/crypto';
import { MAX_NOTE_BYTES, type ExpiryOption, type TimedExpiry } from '../../src/lib/limits';

export interface AccountRules {
  name: string;
  teamName: string;
  plan: 'free' | 'standard' | 'business';
  requirePassword: boolean;
  maxLifetimeDays: number;
  timedExpiry: TimedExpiry[];
  maxReads: number;
}

export type NoteInput =
  | { kind: 'quick'; text: string; password?: string; expiresIn: ExpiryOption; maxReads: number }
  | {
      kind: 'account';
      text: string;
      password?: string;
      title: string;
      shred: { mode: 'read'; maxReads: number } | { mode: 'time'; expiresIn: TimedExpiry };
    };

export interface CreatedNote {
  link: string;
  /** Quick notes only: a private link that destroys the note early. */
  destroyLink?: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

async function call<T>(
  server: string,
  path: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
  apiKey?: string,
): Promise<T> {
  const headers = new Headers(init.headers);
  if (apiKey) headers.set('Authorization', `Bearer ${apiKey}`);
  let res: Response;
  try {
    res = await fetchImpl(`${server}${path}`, { ...init, headers, credentials: 'omit' });
  } catch {
    throw new ApiError('Couldn’t reach Vanishnote. Check your connection and try again.', 0, 'network');
  }
  const body = (await res.json().catch(() => null)) as (T & { error?: string; message?: string }) | null;
  if (!res.ok) {
    const fallback = res.status === 401 ? 'That API key isn’t valid any more. Update it in the extension settings.' : 'Something went wrong. Please try again.';
    throw new ApiError(body?.message ?? fallback, res.status, body?.error ?? 'error');
  }
  return body as T;
}

/** The signed-in account's rules, or an ApiError (401 for a bad key). */
export function fetchRules(server: string, apiKey: string, fetchImpl: typeof fetch = fetch): Promise<AccountRules> {
  return call<AccountRules>(server, '/api/account/policy', { method: 'GET' }, fetchImpl, apiKey);
}

export function validate(input: NoteInput, rules?: AccountRules): string | null {
  if (input.text.trim() === '') return 'Write the note first.';
  if (utf8ByteLength(input.text) > MAX_NOTE_BYTES) return `The note is too long. The limit is ${MAX_NOTE_BYTES / 1024} KB.`;
  if (input.kind === 'account') {
    if (input.title.trim() === '') return 'Give the note a title so you can find it in your dashboard.';
    if (rules?.requirePassword && !input.password) return 'Your team requires a password on every note.';
  }
  return null;
}

export async function createNote(
  server: string,
  input: NoteInput,
  options: { apiKey?: string; fetchImpl?: typeof fetch } = {},
): Promise<CreatedNote> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sealed = await sealNote(input.text, input.password || undefined);
  const json = { 'Content-Type': 'application/json' };

  if (input.kind === 'quick') {
    const created = await call<{ id: string; deleteToken: string }>(
      server,
      '/api/notes',
      { method: 'POST', headers: json, body: JSON.stringify({ ...sealed.payload, options: { expiresIn: input.expiresIn, maxReads: input.maxReads } }) },
      fetchImpl,
    );
    return { link: `${server}/n/${created.id}#${sealed.linkKey}`, destroyLink: `${server}/d/${created.id}#${created.deleteToken}` };
  }

  if (!options.apiKey) throw new ApiError('Add your API key in the extension settings first.', 401, 'unauthorized');
  const created = await call<{ id: string; path: string }>(
    server,
    '/api/account/notes',
    { method: 'POST', headers: json, body: JSON.stringify({ ...sealed.payload, title: input.title.trim(), shred: input.shred }) },
    fetchImpl,
    options.apiKey,
  );
  return { link: `${server}${created.path}#${sealed.linkKey}` };
}

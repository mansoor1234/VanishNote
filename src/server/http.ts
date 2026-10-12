import type { ErrorResponse } from '../lib/schema';

/**
 * Security headers applied to every response the Worker renders. Static pages get the
 * same set from public/_headers. Keep the two in sync (tests/unit/headers.test.ts checks).
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
].join('; ');

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'Permissions-Policy':
    'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), interest-cohort=(), browsing-topics=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

/** Extra headers for anything that touches a note: never cache, never index. */
export const PRIVATE_HEADERS: Readonly<Record<string, string>> = {
  'Cache-Control': 'no-store, max-age=0',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
};

export function isPrivatePath(pathname: string): boolean {
  return /^\/(n|d|api)(\/|$)/.test(pathname);
}

export function json(body: unknown, status = 200, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...PRIVATE_HEADERS, ...extra },
  });
}

export function noContent(): Response {
  return new Response(null, { status: 204, headers: { ...PRIVATE_HEADERS } });
}

export function error(status: number, code: string, message: string, extra?: Record<string, string>): Response {
  const body: ErrorResponse = { error: code, message };
  return json(body, status, extra);
}

/** The single response for missing, consumed, expired, or wrong-token notes. */
export const NOT_FOUND_MESSAGE = "This note doesn't exist or has already been read.";
export function notFound(): Response {
  return error(404, 'not_found', NOT_FOUND_MESSAGE);
}

export function tooManyRequests(): Response {
  return error(
    429,
    'rate_limited',
    "You're going a little fast. Please wait a minute and try again.",
    { 'Retry-After': '60' },
  );
}

export class BodyError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Read a JSON body with a hard size cap, without trusting Content-Length alone. */
export async function readJson(request: Request, maxBytes: number): Promise<unknown> {
  const type = request.headers.get('Content-Type') ?? '';
  if (!/^application\/json\s*(;|$)/i.test(type)) {
    throw new BodyError(415, 'unsupported_media_type', 'Expected an application/json body.');
  }
  const declared = Number(request.headers.get('Content-Length') ?? '0');
  if (declared > maxBytes) throw new BodyError(413, 'too_large', 'Request body is too large.');

  const reader = request.body?.getReader();
  if (!reader) throw new BodyError(400, 'invalid_body', 'Request body is required.');
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new BodyError(413, 'too_large', 'Request body is too large.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new BodyError(400, 'invalid_json', 'Request body is not valid JSON.');
  }
}

/**
 * Read a multipart body with a "meta" JSON field and an optional "file" field. Rejects bodies
 * larger than `maxBytes` (declared length) before parsing.
 */
export async function readMultipart(
  request: Request,
  maxBytes: number,
): Promise<{ meta: unknown; file: File | null }> {
  const type = request.headers.get('Content-Type') ?? '';
  if (!/^multipart\/form-data\s*;/i.test(type)) {
    throw new BodyError(415, 'unsupported_media_type', 'Expected a multipart/form-data body.');
  }
  const declared = Number(request.headers.get('Content-Length') ?? 'NaN');
  if (!Number.isFinite(declared)) throw new BodyError(411, 'length_required', 'Content-Length is required.');
  if (declared > maxBytes) throw new BodyError(413, 'too_large', 'That file is too large for your plan.');
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new BodyError(400, 'invalid_body', 'The upload could not be read.');
  }
  const metaField = form.get('meta');
  if (typeof metaField !== 'string') throw new BodyError(400, 'invalid_body', 'Missing meta field.');
  let meta: unknown;
  try {
    meta = JSON.parse(metaField);
  } catch {
    throw new BodyError(400, 'invalid_json', 'The meta field is not valid JSON.');
  }
  const file = form.get('file');
  return { meta, file: file instanceof File && file.size > 0 ? file : null };
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Shortened, non-reversible identifier for logs. Never log a full note ID. */
export function redactId(id: string): string {
  return `${id.slice(0, 4)}…`;
}

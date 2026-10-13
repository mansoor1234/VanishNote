/** Small fetch wrappers for the account API. Errors come back as { ok: false, message }. */

export type Result<T = unknown> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string; message: string; retryAfter?: number };

const NETWORK_ERROR = "We couldn't reach Vanishnote. Check your connection and try again.";

async function send<T>(path: string, init: RequestInit): Promise<Result<T>> {
  let response: Response;
  try {
    response = await fetch(path, { ...init, credentials: 'same-origin', cache: 'no-store', referrerPolicy: 'no-referrer' });
  } catch {
    return { ok: false, status: 0, error: 'network', message: NETWORK_ERROR };
  }
  let body: unknown = null;
  if (response.status !== 204) {
    try {
      body = await response.json();
    } catch {
      body = null;
    }
  }
  if (response.ok) return { ok: true, status: response.status, data: body as T };
  if (response.status === 401 && path.startsWith('/api/account/')) {
    location.assign(`/login?next=${encodeURIComponent(location.pathname)}`);
  }
  const err = body as { error?: string; message?: string } | null;
  const retryAfter = Number(response.headers.get('Retry-After'));
  return {
    ok: false,
    status: response.status,
    error: err?.error ?? 'error',
    message: err?.message ?? 'Something went wrong. Please try again.',
    ...(retryAfter > 0 ? { retryAfter } : {}),
  };
}

export function getJson<T = unknown>(path: string): Promise<Result<T>> {
  return send<T>(path, { method: 'GET' });
}

export function postJson<T = unknown>(path: string, body: unknown, method = 'POST'): Promise<Result<T>> {
  return send<T>(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

export function postForm<T = unknown>(path: string, form: FormData): Promise<Result<T>> {
  return send<T>(path, { method: 'POST', body: form });
}

export function del<T = unknown>(path: string, body?: unknown): Promise<Result<T>> {
  return body === undefined
    ? send<T>(path, { method: 'DELETE' })
    : send<T>(path, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

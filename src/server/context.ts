import type { Limiter } from './api';
import type { SessionUser } from './auth';

/** The bindings and vars the server needs. `Env` from cloudflare:workers satisfies this. */
export interface AppEnv {
  DB: D1Database;
  FILES: R2Bucket;
  APP_URL: string;
  EMAIL_FROM: string;
  RESEND_API_KEY?: string;
  DEV_OUTBOX?: string;
  TURNSTILE_SECRET_KEY?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  CREATE_LIMITER?: Limiter;
  READ_LIMITER?: Limiter;
  AUTH_LIMITER?: Limiter;
}

export interface Ctx {
  env: AppEnv;
  request: Request;
  url: URL;
  now: number;
  waitUntil: (promise: Promise<unknown>) => void;
  /** Two-letter country code from Cloudflare, if known. Never an IP address. */
  country: string | null;
  /** Set once the session has been checked. */
  user?: SessionUser;
}

export function createCtx(
  request: Request,
  env: AppEnv,
  options: { now?: number; waitUntil?: (promise: Promise<unknown>) => void } = {},
): Ctx {
  const cf = (request as Request & { cf?: { country?: unknown } }).cf;
  const country = typeof cf?.country === 'string' && /^[A-Z]{2}$/.test(cf.country) ? cf.country : null;
  return {
    env,
    request,
    url: new URL(request.url),
    now: options.now ?? Date.now(),
    waitUntil: options.waitUntil ?? ((promise) => void promise.catch(() => {})),
    country,
  };
}

export function isLocalRequest(url: URL): boolean {
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
}

/** Absolute URL on the public site, for emails. Uses APP_URL, never the request's Host header. */
export function appLink(env: AppEnv, path: string): string {
  return new URL(path, env.APP_URL).href;
}

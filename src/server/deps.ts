import { env } from 'cloudflare:workers';
import type { ApiDeps } from './api';
import { createCtx, type Ctx } from './context';
import { createResendNotifier } from './email';
import { onAccountNoteRead } from './records';

/** Real bindings for the anonymous note handlers. */
export function apiDeps(locals: App.Locals, request: Request): ApiDeps {
  const ctx = locals.cfContext;
  const waitUntil = (promise: Promise<unknown>) => ctx.waitUntil(promise);
  const { country } = createCtx(request, env);
  const deps: ApiDeps = {
    db: env.DB,
    createLimiter: env.CREATE_LIMITER,
    readLimiter: env.READ_LIMITER,
    waitUntil,
    onAccountRead: (id, note, now) => onAccountNoteRead(env, id, note, now, country, waitUntil),
  };
  const notify = createResendNotifier({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM, appUrl: env.APP_URL });
  if (notify) deps.notify = notify;
  return deps;
}

/** Request context with real bindings, for the account API and server-rendered pages. */
export function requestCtx(locals: App.Locals, request: Request): Ctx {
  const ctx = locals.cfContext;
  return createCtx(request, env, { waitUntil: (promise) => ctx.waitUntil(promise) });
}

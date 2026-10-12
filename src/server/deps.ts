import { env } from 'cloudflare:workers';
import type { ApiDeps } from './api';
import { createResendNotifier } from './email';

/** Real bindings for the API handlers. */
export function apiDeps(locals: App.Locals): ApiDeps {
  const ctx = locals.cfContext;
  const deps: ApiDeps = {
    db: env.DB,
    createLimiter: env.CREATE_LIMITER,
    readLimiter: env.READ_LIMITER,
    waitUntil: (promise) => ctx.waitUntil(promise),
  };
  const notify = createResendNotifier({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM, appUrl: env.APP_URL });
  if (notify) deps.notify = notify;
  return deps;
}

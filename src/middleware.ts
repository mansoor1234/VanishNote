import { defineMiddleware } from 'astro:middleware';
import { getSessionUser } from './server/auth';
import { requestCtx } from './server/deps';
import { isPrivatePath, PRIVATE_HEADERS, SECURITY_HEADERS, TURNSTILE_CSP, TURNSTILE_PATHS } from './server/http';

/**
 * - /app/*: requires a session; sets locals.user.
 * - /login, /signup: skip straight to the dashboard when already logged in.
 * - Security headers for everything rendered on demand. Prerendered pages are served straight
 *   from static assets and get the same headers from public/_headers.
 */
export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;
  // Logos set their own locked-down headers (sandboxed CSP, cross-origin for email clients).
  if (context.isPrerendered || pathname.startsWith('/brand/')) return next();

  if (/^\/(app|login|signup|join)(\/|$)/.test(pathname)) {
    const user = await getSessionUser(requestCtx(context.locals, context.request));
    if (user) context.locals.user = user;
    if (pathname.startsWith('/app') && !user) {
      return context.redirect(`/login?next=${encodeURIComponent(pathname + context.url.search)}`, 303);
    }
    if ((pathname === '/login' || pathname === '/signup') && user) return context.redirect('/app', 303);
  }

  const response = await next();
  const secured = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) secured.headers.set(name, value);
  if (TURNSTILE_PATHS.test(pathname)) secured.headers.set('Content-Security-Policy', TURNSTILE_CSP);
  if (isPrivatePath(pathname)) {
    for (const [name, value] of Object.entries(PRIVATE_HEADERS)) secured.headers.set(name, value);
  } else {
    secured.headers.set('Cache-Control', 'no-store');
  }
  return secured;
});

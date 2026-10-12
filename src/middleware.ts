import { defineMiddleware } from 'astro:middleware';
import { isPrivatePath, PRIVATE_HEADERS, SECURITY_HEADERS } from './server/http';

/**
 * Security headers for everything the Worker renders on demand (note pages and the API).
 * Prerendered pages are served straight from static assets and get the same headers
 * from public/_headers.
 */
export const onRequest = defineMiddleware(async (context, next) => {
  const response = await next();
  if (context.isPrerendered) return response;

  const secured = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) secured.headers.set(name, value);
  if (isPrivatePath(context.url.pathname)) {
    for (const [name, value] of Object.entries(PRIVATE_HEADERS)) secured.headers.set(name, value);
  }
  return secured;
});

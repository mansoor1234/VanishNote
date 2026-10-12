import { isLocalRequest, type Ctx } from './context';

/**
 * Verify a Cloudflare Turnstile token. Without a secret configured, only localhost requests
 * are let through (local development and tests); anything else fails closed.
 */
export async function verifyTurnstile(ctx: Ctx, token: string | undefined, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const secret = ctx.env.TURNSTILE_SECRET_KEY;
  if (!secret) return isLocalRequest(ctx.url);
  if (!token) return false;
  const body = new FormData();
  body.set('secret', secret);
  body.set('response', token);
  const ip = ctx.request.headers.get('CF-Connecting-IP');
  if (ip) body.set('remoteip', ip);
  try {
    const res = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

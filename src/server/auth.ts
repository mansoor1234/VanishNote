/**
 * Accounts and sessions.
 *
 * The browser never sends the password. It sends authKey = HKDF(PBKDF2-SHA256(password,
 * SHA-256(email), 600k)) (see src/lib/crypto.ts). We store SHA-256(salt || authKey): authKey is
 * already a slow, high-entropy derivation, so an offline guess still costs 600k PBKDF2 rounds,
 * and logins stay cheap enough for the Workers CPU budget (Workers caps PBKDF2 at 100k anyway).
 */
import { z } from 'zod';
import { fromBase64Url, randomBytes, toBase64Url } from '../lib/encoding';
import { isPlanId, type PlanId } from '../lib/plans';
import { appLink, type Ctx } from './context';
import { error, json, readJson, sha256Hex, BodyError } from './http';
import { createMailer, sendInBackground } from './mail';
import { resetEmail, signupExistingEmail, verifyEmail } from './templates';
import { verifyTurnstile } from './turnstile';

export const SESSION_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: 'owner' | 'member';
  teamId: string;
  teamName: string;
  plan: PlanId;
  seats: number;
  brandId: string | null;
  brandName: string | null;
  hasLogo: boolean;
}

const authKeySchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const emailSchema = z.email().max(254).transform((e) => e.trim().toLowerCase());
const nameSchema = z.string().trim().min(1).max(80);
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export function newId(bytes = 16): string {
  return toBase64Url(randomBytes(bytes));
}

export async function hashAuthKey(salt: string, authKey: string): Promise<string> {
  const data = new Uint8Array([...fromBase64Url(salt), ...fromBase64Url(authKey)]);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return toBase64Url(new Uint8Array(digest));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// --- cookies -----------------------------------------------------------------------------------

export function sessionCookieName(url: URL): string {
  return url.protocol === 'https:' ? '__Host-vn_session' : 'vn_session';
}

export function sessionCookie(url: URL, token: string, maxAgeSeconds: number): string {
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  return `${sessionCookieName(url)}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

function readSessionToken(request: Request, url: URL): string | null {
  const header = request.headers.get('Cookie') ?? '';
  const name = sessionCookieName(url);
  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) {
      const token = value.join('=');
      return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
    }
  }
  return null;
}

export async function createSession(ctx: Ctx, userId: string): Promise<string> {
  const token = newId(32);
  await ctx.env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?1, ?2, ?3, ?4)')
    .bind(await sha256Hex(token), userId, ctx.now + SESSION_DAYS * DAY, ctx.now)
    .run();
  return sessionCookie(ctx.url, token, SESSION_DAYS * 24 * 60 * 60);
}

export async function getSessionUser(ctx: Ctx): Promise<SessionUser | undefined> {
  const token = readSessionToken(ctx.request, ctx.url);
  if (!token) return undefined;
  const row = await ctx.env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.role, t.id AS team_id, t.name AS team_name, t.plan, t.seats,
            t.brand_id, t.brand_name, t.brand_logo_key
       FROM sessions s JOIN users u ON u.id = s.user_id JOIN teams t ON t.id = u.team_id
      WHERE s.token_hash = ?1 AND s.expires_at > ?2 AND u.email_verified_at IS NOT NULL`,
  )
    .bind(await sha256Hex(token), ctx.now)
    .first<Record<string, string | number | null>>();
  if (!row) return undefined;
  return {
    id: String(row['id']),
    email: String(row['email']),
    name: String(row['name']),
    role: row['role'] === 'member' ? 'member' : 'owner',
    teamId: String(row['team_id']),
    teamName: String(row['team_name']),
    plan: isPlanId(row['plan']) ? row['plan'] : 'free',
    seats: Number(row['seats']),
    brandId: (row['brand_id'] as string | null) ?? null,
    brandName: (row['brand_name'] as string | null) ?? null,
    hasLogo: row['brand_logo_key'] != null,
  };
}

// --- tokens ------------------------------------------------------------------------------------

type TokenPurpose = 'verify' | 'reset' | 'invite';

export async function issueToken(
  ctx: Ctx,
  purpose: TokenPurpose,
  email: string,
  ttlMs: number,
  ids: { userId?: string; teamId?: string },
): Promise<string> {
  const token = newId(32);
  await ctx.env.DB.prepare(
    'INSERT INTO email_tokens (token_hash, purpose, user_id, team_id, email, expires_at, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)',
  )
    .bind(await sha256Hex(token), purpose, ids.userId ?? null, ids.teamId ?? null, email, ctx.now + ttlMs, ctx.now)
    .run();
  return token;
}

/** Single-use: the token row is deleted in the same statement that reads it. */
export async function consumeToken(
  ctx: Ctx,
  purpose: TokenPurpose,
  token: string,
): Promise<{ user_id: string | null; team_id: string | null; email: string } | null> {
  return ctx.env.DB.prepare(
    'DELETE FROM email_tokens WHERE token_hash = ?1 AND purpose = ?2 AND expires_at > ?3 RETURNING user_id, team_id, email',
  )
    .bind(await sha256Hex(token), purpose, ctx.now)
    .first();
}

// --- handlers ----------------------------------------------------------------------------------

async function body<T extends z.ZodType>(ctx: Ctx, schema: T): Promise<z.infer<T> | Response> {
  let raw: unknown;
  try {
    raw = await readJson(ctx.request, 8 * 1024);
  } catch (err) {
    if (err instanceof BodyError) return error(err.status, err.code, err.message);
    throw err;
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => i.path.join('.') || '(root)'))];
    return error(400, 'invalid_request', `Please check: ${fields.join(', ')}.`);
  }
  return parsed.data;
}
export { body as parseBody };

const CHECK_EMAIL = { ok: true, message: 'Check your email for a link to continue.' };

async function sendVerification(ctx: Ctx, user: { id: string; email: string; name: string }) {
  const token = await issueToken(ctx, 'verify', user.email, DAY, { userId: user.id });
  sendInBackground(createMailer(ctx.env), verifyEmail(user.email, user.name, appLink(ctx.env, `/verify#${token}`)), ctx.waitUntil);
}

export async function handleSignup(ctx: Ctx): Promise<Response> {
  const input = await body(
    ctx,
    z.strictObject({ name: nameSchema, email: emailSchema, authKey: authKeySchema, turnstileToken: z.string().max(4096).optional() }),
  );
  if (input instanceof Response) return input;
  if (!(await verifyTurnstile(ctx, input.turnstileToken))) {
    return error(400, 'captcha_failed', 'Please complete the “I’m human” check and try again.');
  }

  const existing = await ctx.env.DB.prepare('SELECT id, name, email_verified_at FROM users WHERE email = ?1')
    .bind(input.email)
    .first<{ id: string; name: string; email_verified_at: number | null }>();
  // Same response whether or not the address is registered, so sign-up can't be used to probe emails.
  if (existing) {
    if (existing.email_verified_at === null) {
      await sendVerification(ctx, { id: existing.id, email: input.email, name: existing.name });
    } else {
      sendInBackground(
        createMailer(ctx.env),
        signupExistingEmail(input.email, appLink(ctx.env, '/login'), appLink(ctx.env, '/forgot')),
        ctx.waitUntil,
      );
    }
    return json(CHECK_EMAIL, 202);
  }

  const teamId = newId();
  const userId = newId();
  const salt = toBase64Url(randomBytes(16));
  await ctx.env.DB.batch([
    ctx.env.DB.prepare('INSERT INTO teams (id, name, created_at) VALUES (?1, ?2, ?3)').bind(teamId, `${input.name}’s team`, ctx.now),
    ctx.env.DB.prepare(
      'INSERT INTO users (id, team_id, role, email, name, auth_salt, auth_hash, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)',
    ).bind(userId, teamId, 'owner', input.email, input.name, salt, await hashAuthKey(salt, input.authKey), ctx.now),
  ]);
  await sendVerification(ctx, { id: userId, email: input.email, name: input.name });
  return json(CHECK_EMAIL, 202);
}

export async function handleVerify(ctx: Ctx): Promise<Response> {
  const input = await body(ctx, z.strictObject({ token: tokenSchema }));
  if (input instanceof Response) return input;
  const token = await consumeToken(ctx, 'verify', input.token);
  if (!token?.user_id) {
    return error(400, 'invalid_token', 'This link has expired or was already used. Log in, or ask for a new link.');
  }
  await ctx.env.DB.prepare('UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?2) WHERE id = ?1')
    .bind(token.user_id, ctx.now)
    .run();
  return json({ ok: true }, 200, { 'Set-Cookie': await createSession(ctx, token.user_id) });
}

export async function handleResendVerification(ctx: Ctx): Promise<Response> {
  const input = await body(ctx, z.strictObject({ email: emailSchema, turnstileToken: z.string().max(4096).optional() }));
  if (input instanceof Response) return input;
  if (!(await verifyTurnstile(ctx, input.turnstileToken))) {
    return error(400, 'captcha_failed', 'Please complete the “I’m human” check and try again.');
  }
  const user = await ctx.env.DB.prepare('SELECT id, name FROM users WHERE email = ?1 AND email_verified_at IS NULL')
    .bind(input.email)
    .first<{ id: string; name: string }>();
  if (user) await sendVerification(ctx, { id: user.id, email: input.email, name: user.name });
  return json(CHECK_EMAIL, 202);
}

/** A fixed salt for the dummy hash, so unknown emails take as long as known ones. */
const DUMMY_SALT = 'AAAAAAAAAAAAAAAAAAAAAA';

export async function handleLogin(ctx: Ctx): Promise<Response> {
  const input = await body(ctx, z.strictObject({ email: emailSchema, authKey: authKeySchema }));
  if (input instanceof Response) return input;
  const user = await ctx.env.DB.prepare('SELECT id, auth_salt, auth_hash, email_verified_at FROM users WHERE email = ?1')
    .bind(input.email)
    .first<{ id: string; auth_salt: string; auth_hash: string; email_verified_at: number | null }>();
  const hash = await hashAuthKey(user?.auth_salt ?? DUMMY_SALT, input.authKey);
  if (!user || !timingSafeEqual(hash, user.auth_hash)) {
    return error(401, 'invalid_credentials', 'That email and password don’t match an account.');
  }
  if (user.email_verified_at === null) {
    return error(403, 'unverified', 'Please confirm your email first. We can send you a new link.');
  }
  return json({ ok: true }, 200, { 'Set-Cookie': await createSession(ctx, user.id) });
}

export async function handleLogout(ctx: Ctx): Promise<Response> {
  const token = readSessionToken(ctx.request, ctx.url);
  if (token) await ctx.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?1').bind(await sha256Hex(token)).run();
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(ctx.url, '', 0) });
}

export async function handleForgot(ctx: Ctx): Promise<Response> {
  const input = await body(ctx, z.strictObject({ email: emailSchema, turnstileToken: z.string().max(4096).optional() }));
  if (input instanceof Response) return input;
  if (!(await verifyTurnstile(ctx, input.turnstileToken))) {
    return error(400, 'captcha_failed', 'Please complete the “I’m human” check and try again.');
  }
  const user = await ctx.env.DB.prepare('SELECT id FROM users WHERE email = ?1').bind(input.email).first<{ id: string }>();
  if (user) {
    const token = await issueToken(ctx, 'reset', input.email, 60 * 60 * 1000, { userId: user.id });
    sendInBackground(createMailer(ctx.env), resetEmail(input.email, appLink(ctx.env, `/reset#${token}`)), ctx.waitUntil);
  }
  return json(CHECK_EMAIL, 202);
}

export async function handleReset(ctx: Ctx): Promise<Response> {
  const input = await body(ctx, z.strictObject({ token: tokenSchema, email: emailSchema, authKey: authKeySchema }));
  if (input instanceof Response) return input;
  const token = await consumeToken(ctx, 'reset', input.token);
  if (!token?.user_id || token.email !== input.email) {
    return error(400, 'invalid_token', 'This reset link has expired or doesn’t match that email. Ask for a new one.');
  }
  const salt = toBase64Url(randomBytes(16));
  await ctx.env.DB.batch([
    ctx.env.DB.prepare(
      'UPDATE users SET auth_salt = ?2, auth_hash = ?3, email_verified_at = COALESCE(email_verified_at, ?4) WHERE id = ?1',
    ).bind(token.user_id, salt, await hashAuthKey(salt, input.authKey), ctx.now),
    // Log out everywhere else.
    ctx.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(token.user_id),
  ]);
  return json({ ok: true }, 200, { 'Set-Cookie': await createSession(ctx, token.user_id) });
}

/** For settings: check the current password's auth key. */
export async function checkAuthKey(ctx: Ctx, userId: string, authKey: string): Promise<boolean> {
  const row = await ctx.env.DB.prepare('SELECT auth_salt, auth_hash FROM users WHERE id = ?1')
    .bind(userId)
    .first<{ auth_salt: string; auth_hash: string }>();
  if (!row) return false;
  return timingSafeEqual(await hashAuthKey(row.auth_salt, authKey), row.auth_hash);
}

export { authKeySchema, emailSchema, nameSchema, tokenSchema };

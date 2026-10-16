/**
 * Sign in with Google or Microsoft (OpenID Connect authorization-code flow with PKCE).
 *
 * The account password is never a key for note encryption (notes carry their own keys in the
 * link), so signing in through a provider doesn't weaken what we can't read.
 *
 * Safety rules:
 * - state is single-use, stored hashed, expires in 10 minutes, and must match a cookie set in the
 *   same browser (no login CSRF); a nonce binds the ID token to this sign-in.
 * - The ID token comes straight from the provider's token endpoint over TLS, authenticated with
 *   our client secret, so its signature needn't be checked (OpenID Connect Core 3.1.3.7); we still
 *   check issuer, audience, expiry and nonce.
 * - An existing account is only matched by email when the provider says it verified that email
 *   (Google: email_verified; Microsoft: personal accounts, or the xms_edov claim for work
 *   accounts). Otherwise the identity must be linked from Settings while signed in.
 * - Matching an unconfirmed account wipes its password first, so nobody can pre-register someone
 *   else's address with their own password and inherit the account.
 */
import { fromBase64Url, randomBytes, toBase64Url } from '../lib/encoding';
import { PLANS } from '../lib/plans';
import { LEGAL_UPDATED } from '../lib/site';
import { audit, auditSignIn, auditStatement } from './audit';
import { createSession, getSessionUser, hashAuthKey, newId } from './auth';
import { appLink, type AppEnv, type Ctx } from './context';
import { error, noContent, sha256Hex } from './http';

export type Provider = 'google' | 'microsoft';
type Mode = 'login' | 'signup' | 'link';

interface ProviderConfig {
  name: string;
  authorize: string;
  token: string;
  clientId: (env: AppEnv) => string | undefined;
  clientSecret: (env: AppEnv) => string | undefined;
  /** Turn verified ID-token claims into an identity, or null if the token is not acceptable. */
  identity: (claims: Record<string, unknown>) => Identity | null;
}

interface Identity {
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}

/** Personal Microsoft accounts (outlook.com, hotmail.com…) sign in from this tenant. */
const MICROSOFT_CONSUMER_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';

const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null);

export const PROVIDERS: Record<Provider, ProviderConfig> = {
  google: {
    name: 'Google',
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    clientId: (env) => env.GOOGLE_CLIENT_ID,
    clientSecret: (env) => env.GOOGLE_CLIENT_SECRET,
    identity: (c) => {
      const iss = str(c['iss']);
      const sub = str(c['sub']);
      if (!sub || (iss !== 'https://accounts.google.com' && iss !== 'accounts.google.com')) return null;
      return { subject: sub, email: str(c['email']), emailVerified: c['email_verified'] === true, name: str(c['name']) };
    },
  },
  microsoft: {
    name: 'Microsoft',
    authorize: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    clientId: (env) => env.MICROSOFT_CLIENT_ID,
    clientSecret: (env) => env.MICROSOFT_CLIENT_SECRET,
    identity: (c) => {
      const tid = str(c['tid']);
      const oid = str(c['oid']) ?? str(c['sub']);
      if (!tid || !oid || c['iss'] !== `https://login.microsoftonline.com/${tid}/v2.0`) return null;
      const edov = c['xms_edov'];
      return {
        subject: `${tid}:${oid}`,
        email: str(c['email']),
        // The email claim of a work account is set by its admin and can be anything, unless
        // Microsoft says the domain owner verified it.
        emailVerified: tid === MICROSOFT_CONSUMER_TENANT || edov === true || edov === 1 || edov === '1' || edov === 'true',
        name: str(c['name']),
      };
    },
  },
};

export function isProvider(value: unknown): value is Provider {
  return value === 'google' || value === 'microsoft';
}

export function enabledProviders(env: AppEnv): Provider[] {
  return (Object.keys(PROVIDERS) as Provider[]).filter((p) => PROVIDERS[p].clientId(env) && PROVIDERS[p].clientSecret(env));
}

export const SSO_ERRORS: Record<string, string> = {
  unavailable: 'That sign-in option isn’t available right now.',
  cancelled: 'Sign-in was cancelled.',
  expired: 'That sign-in took too long or was opened in a different browser. Please try again.',
  failed: 'We couldn’t complete the sign-in. Please try again.',
  terms: 'Please accept the terms and privacy policy first.',
  no_account: 'There’s no Vanishnote account for that email yet. Create one below.',
  unverified:
    'That provider didn’t confirm your email address, so we can’t match it to an account. Log in with your password, then connect it in Settings.',
  linked_elsewhere: 'That account is already connected to a different Vanishnote account.',
  no_email: 'That provider didn’t share an email address with us.',
};

const STATE_TTL_MS = 10 * 60 * 1000;

function stateCookieName(url: URL): string {
  return url.protocol === 'https:' ? '__Host-vn_sso' : 'vn_sso';
}

function stateCookie(url: URL, value: string, maxAge: number): string {
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  return `${stateCookieName(url)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function readStateCookie(request: Request, url: URL): string | null {
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === stateCookieName(url)) return value.join('=');
  }
  return null;
}

/** Only same-site paths, never "//host" or "/\host". */
function safeNext(next: string | null): string | null {
  return next && /^\/(?![/\\])[A-Za-z0-9/_\-.?=&%#]*$/.test(next) && next.length <= 300 ? next : null;
}

function redirect(location: string, cookies: string[] = []): Response {
  const res = new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store' } });
  for (const cookie of cookies) res.headers.append('Set-Cookie', cookie);
  return res;
}

function failPath(mode: Mode, code: string): string {
  const page = mode === 'signup' ? '/signup' : mode === 'link' ? '/app/settings' : '/login';
  return `${page}?sso_error=${code}`;
}

function redirectUri(env: AppEnv, provider: Provider): string {
  return appLink(env, `/api/auth/sso/${provider}/callback`);
}

/** GET /api/auth/sso/:provider/start?mode=login|signup|link&next=/app&terms=1 */
export async function handleSsoStart(ctx: Ctx, providerParam: string): Promise<Response> {
  const modeParam = ctx.url.searchParams.get('mode');
  const mode: Mode = modeParam === 'signup' || modeParam === 'link' ? modeParam : 'login';
  if (!isProvider(providerParam) || !enabledProviders(ctx.env).includes(providerParam)) {
    return redirect(failPath(mode, 'unavailable'));
  }
  const provider = PROVIDERS[providerParam];
  if (mode === 'signup' && ctx.url.searchParams.get('terms') !== '1') return redirect(failPath(mode, 'terms'));
  let userId: string | null = null;
  if (mode === 'link') {
    const user = await getSessionUser(ctx);
    if (!user) return redirect('/login?next=%2Fapp%2Fsettings');
    userId = user.id;
  }

  const state = newId(32);
  const nonce = newId(16);
  const verifier = newId(32);
  const challenge = toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  await ctx.env.DB.prepare(
    `INSERT INTO sso_states (state_hash, provider, mode, nonce, code_verifier, user_id, next_path, expires_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
  )
    .bind(await sha256Hex(state), providerParam, mode, nonce, verifier, userId, safeNext(ctx.url.searchParams.get('next')), ctx.now + STATE_TTL_MS)
    .run();

  const target = new URL(provider.authorize);
  target.search = new URLSearchParams({
    client_id: provider.clientId(ctx.env)!,
    response_type: 'code',
    redirect_uri: redirectUri(ctx.env, providerParam),
    scope: 'openid email profile',
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();
  return redirect(target.href, [stateCookie(ctx.url, state, STATE_TTL_MS / 1000)]);
}

function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload: unknown = JSON.parse(new TextDecoder().decode(fromBase64Url(parts[1]!)));
    return payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Exchange the code and check the ID token. Overridable fetch for tests. */
async function fetchIdentity(
  ctx: Ctx,
  provider: Provider,
  code: string,
  verifier: string,
  nonce: string,
  fetchImpl: typeof fetch,
): Promise<Identity | null> {
  const config = PROVIDERS[provider];
  const res = await fetchImpl(config.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(ctx.env, provider),
      client_id: config.clientId(ctx.env)!,
      client_secret: config.clientSecret(ctx.env)!,
      code_verifier: verifier,
    }),
  });
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as { id_token?: unknown } | null;
  const claims = typeof body?.id_token === 'string' ? decodeJwtPayload(body.id_token) : null;
  if (!claims) return null;
  const aud = claims['aud'];
  const audOk = aud === config.clientId(ctx.env) || (Array.isArray(aud) && aud.includes(config.clientId(ctx.env)));
  const exp = typeof claims['exp'] === 'number' ? claims['exp'] : 0;
  if (!audOk || exp * 1000 < ctx.now - 60_000 || claims['nonce'] !== nonce) return null;
  return config.identity(claims);
}

export const ssoDeps: { fetch: typeof fetch } = { fetch: (input, init) => fetch(input, init) };

/** GET /api/auth/sso/:provider/callback?code=…&state=… */
export async function handleSsoCallback(ctx: Ctx, providerParam: string): Promise<Response> {
  const clear = stateCookie(ctx.url, '', 0);
  const state = ctx.url.searchParams.get('state') ?? '';
  const cookie = readStateCookie(ctx.request, ctx.url);
  if (!isProvider(providerParam) || !/^[A-Za-z0-9_-]{43}$/.test(state)) return redirect(failPath('login', 'failed'), [clear]);

  const row = await ctx.env.DB.prepare(
    'DELETE FROM sso_states WHERE state_hash = ?1 AND provider = ?2 AND expires_at > ?3 RETURNING mode, nonce, code_verifier, user_id, next_path',
  )
    .bind(await sha256Hex(state), providerParam, ctx.now)
    .first<{ mode: Mode; nonce: string; code_verifier: string; user_id: string | null; next_path: string | null }>();
  if (!row || !cookie || !timingSafeEqual(cookie, state)) return redirect(failPath(row?.mode ?? 'login', 'expired'), [clear]);
  const fail = (code: string) => redirect(failPath(row.mode, code), [clear]);

  if (ctx.url.searchParams.has('error')) return fail('cancelled');
  const code = ctx.url.searchParams.get('code');
  if (!code || code.length > 4096) return fail('failed');
  let identity: Identity | null;
  try {
    identity = await fetchIdentity(ctx, providerParam, code, row.code_verifier, row.nonce, ssoDeps.fetch);
  } catch {
    identity = null;
  }
  if (!identity) return fail('failed');
  const email = identity.email?.trim().toLowerCase() ?? null;
  const providerName = PROVIDERS[providerParam].name;

  const linked = await ctx.env.DB.prepare('SELECT user_id FROM user_identities WHERE provider = ?1 AND subject = ?2')
    .bind(providerParam, identity.subject)
    .first<{ user_id: string }>();

  // Connect to the signed-in account (from Settings).
  if (row.mode === 'link') {
    if (!row.user_id) return fail('failed');
    if (linked && linked.user_id !== row.user_id) return fail('linked_elsewhere');
    if (!linked) {
      await ctx.env.DB.prepare('INSERT INTO user_identities (provider, subject, user_id, email, created_at) VALUES (?1, ?2, ?3, ?4, ?5)')
        .bind(providerParam, identity.subject, row.user_id, email ?? '', ctx.now)
        .run();
      const user = await ctx.env.DB.prepare('SELECT team_id, name FROM users WHERE id = ?1').bind(row.user_id).first<{ team_id: string; name: string }>();
      if (user) await auditStatement(ctx, { teamId: user.team_id, id: row.user_id, name: user.name }, 'sso.linked', providerName).run();
    }
    return redirect('/app/settings?sso=linked#sign-in-methods', [clear]);
  }

  let userId = linked?.user_id ?? null;
  if (!userId) {
    if (!email) return fail('no_email');
    if (!identity.emailVerified) return fail('unverified');
    const existing = await ctx.env.DB.prepare('SELECT id, email_verified_at FROM users WHERE email = ?1')
      .bind(email)
      .first<{ id: string; email_verified_at: number | null }>();
    if (existing) {
      userId = existing.id;
      const statements = [
        ctx.env.DB.prepare('INSERT INTO user_identities (provider, subject, user_id, email, created_at) VALUES (?1, ?2, ?3, ?4, ?5)').bind(
          providerParam,
          identity.subject,
          userId,
          email,
          ctx.now,
        ),
      ];
      if (existing.email_verified_at === null) {
        // Never confirmed: whoever set its password didn't prove they own the inbox. Wipe it.
        const salt = toBase64Url(randomBytes(16));
        statements.push(
          ctx.env.DB.prepare('UPDATE users SET email_verified_at = ?2, has_password = 0, auth_salt = ?3, auth_hash = ?4 WHERE id = ?1').bind(
            userId,
            ctx.now,
            salt,
            await hashAuthKey(salt, toBase64Url(randomBytes(32))),
          ),
          ctx.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(userId),
          ctx.env.DB.prepare('DELETE FROM user_identities WHERE user_id = ?1 AND NOT (provider = ?2 AND subject = ?3)').bind(userId, providerParam, identity.subject),
        );
      }
      await ctx.env.DB.batch(statements);
    } else if (row.mode === 'signup') {
      userId = await createSsoAccount(ctx, providerParam, identity.subject, email, identity.name ?? email.split('@')[0]!);
    } else {
      return fail('no_account');
    }
  }

  await auditSignIn(ctx, userId, providerName);
  return redirect(row.next_path ?? '/app', [clear, await createSession(ctx, userId)]);
}

async function createSsoAccount(ctx: Ctx, provider: Provider, subject: string, email: string, name: string): Promise<string> {
  const teamId = newId();
  const userId = newId();
  const salt = toBase64Url(randomBytes(16));
  const displayName = name.trim().slice(0, 80) || 'New user';
  await ctx.env.DB.batch([
    ctx.env.DB.prepare('INSERT INTO teams (id, name, created_at) VALUES (?1, ?2, ?3)').bind(teamId, `${displayName}’s team`, ctx.now),
    // No password: a random hash nobody knows. "Forgot password" can set one later.
    ctx.env.DB.prepare(
      `INSERT INTO users (id, team_id, role, email, name, auth_salt, auth_hash, has_password, email_verified_at, created_at, terms_version, terms_accepted_at)
       VALUES (?1, ?2, 'owner', ?3, ?4, ?5, ?6, 0, ?7, ?7, ?8, ?7)`,
    ).bind(userId, teamId, email, displayName, salt, await hashAuthKey(salt, toBase64Url(randomBytes(32))), ctx.now, LEGAL_UPDATED),
    ctx.env.DB.prepare('INSERT INTO user_identities (provider, subject, user_id, email, created_at) VALUES (?1, ?2, ?3, ?4, ?5)').bind(
      provider,
      subject,
      userId,
      email,
      ctx.now,
    ),
  ]);
  return userId;
}

/** Linked identities and whether the user has a password, for Settings. */
export async function signInMethods(db: D1Database, userId: string) {
  const [identities, user] = await Promise.all([
    db
      .prepare('SELECT provider, email, created_at FROM user_identities WHERE user_id = ?1 ORDER BY created_at')
      .bind(userId)
      .all<{ provider: Provider; email: string; created_at: number }>(),
    db.prepare('SELECT has_password FROM users WHERE id = ?1').bind(userId).first<{ has_password: number }>(),
  ]);
  return { identities: identities.results, hasPassword: user?.has_password !== 0 };
}

/** DELETE /api/account/sso/:provider — never leaves an account with no way to sign in. */
export async function handleSsoUnlink(ctx: Ctx, providerParam: string): Promise<Response> {
  const user = ctx.user!;
  if (!isProvider(providerParam)) return error(404, 'not_found', 'Not found.');
  const { identities, hasPassword } = await signInMethods(ctx.env.DB, user.id);
  if (!identities.some((i) => i.provider === providerParam)) return noContent();
  if (!hasPassword && identities.length === 1) {
    return error(409, 'last_method', 'Set a password first (use “Forgot password”), so you can still sign in.');
  }
  if (user.policy.requireSso && user.role === 'member' && identities.length === 1) {
    return error(409, 'sso_required', 'Your team requires Google or Microsoft sign-in, so keep at least one connected.');
  }
  await ctx.env.DB.prepare('DELETE FROM user_identities WHERE user_id = ?1 AND provider = ?2').bind(user.id, providerParam).run();
  await audit(ctx, 'sso.unlinked', PROVIDERS[providerParam].name);
  return noContent();
}

/** True when this member must use Google or Microsoft instead of a password. */
export async function ssoRequiredFor(db: D1Database, userId: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT u.role, t.plan, t.policy_require_sso FROM users u JOIN teams t ON t.id = u.team_id WHERE u.id = ?1')
    .bind(userId)
    .first<{ role: string; plan: string; policy_require_sso: number }>();
  if (!row || row.role !== 'member' || row.policy_require_sso !== 1) return false;
  const plan = row.plan === 'standard' || row.plan === 'business' || row.plan === 'free' ? row.plan : 'free';
  return PLANS[plan].limits.ssoEnforcement;
}

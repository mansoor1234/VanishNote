/** Account settings, push devices, contact form, and the local-only dev outbox. */
import { z } from 'zod';
import { CONTACT_EMAIL, LEGAL_UPDATED } from '../lib/site';
import { PLANS } from '../lib/plans';
import { audit } from './audit';
import { authKeySchema, checkAuthKey, hashAuthKey, nameSchema, parseBody, sessionCookie, trustDevice } from './auth';
import { isLocalRequest, type Ctx } from './context';
import { randomBytes, toBase64Url } from '../lib/encoding';
import { error, json, noContent, notFound, sha256Hex } from './http';
import { createMailer } from './mail';
import { notifyUser } from './notify';
import { contactEmail } from './templates';
import { isAllowedPushEndpoint } from './webpush';

export async function handleProfile(ctx: Ctx): Promise<Response> {
  const input = await parseBody(ctx, z.strictObject({ name: nameSchema }));
  if (input instanceof Response) return input;
  await ctx.env.DB.prepare('UPDATE users SET name = ?2 WHERE id = ?1').bind(ctx.user!.id, input.name).run();
  return noContent();
}

export async function handleChangePassword(ctx: Ctx): Promise<Response> {
  const user = ctx.user!;
  const input = await parseBody(ctx, z.strictObject({ currentAuthKey: authKeySchema, newAuthKey: authKeySchema }));
  if (input instanceof Response) return input;
  if (!(await checkAuthKey(ctx, user.id, input.currentAuthKey))) {
    return error(403, 'invalid_credentials', 'Your current password is incorrect.');
  }
  const salt = toBase64Url(randomBytes(16));
  await ctx.env.DB.batch([
    ctx.env.DB.prepare('UPDATE users SET auth_salt = ?2, auth_hash = ?3 WHERE id = ?1').bind(
      user.id,
      salt,
      await hashAuthKey(salt, input.newAuthKey),
    ),
    // Sign out every session, including this one; the browser logs in again with the new password.
    ctx.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(user.id),
  ]);
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(ctx.url, '', 0) });
}

/**
 * Delete the account. A team owner with other members must remove them first. Deleting an
 * owner's account deletes the team, its notes, requests, history and files.
 */
export async function handleDeleteAccount(ctx: Ctx): Promise<Response> {
  const user = ctx.user!;
  const input = await parseBody(ctx, z.strictObject({ authKey: authKeySchema }));
  if (input instanceof Response) return input;
  if (!(await checkAuthKey(ctx, user.id, input.authKey))) {
    return error(403, 'invalid_credentials', 'That password is incorrect.');
  }
  const db = ctx.env.DB;
  if (user.role === 'owner') {
    const others = await db.prepare('SELECT COUNT(*) AS n FROM users WHERE team_id = ?1 AND id != ?2').bind(user.teamId, user.id).first<{ n: number }>();
    if ((others?.n ?? 0) > 0) {
      return error(409, 'team_has_members', 'Remove your team members before deleting your account.');
    }
    await db.batch([
      db.prepare('INSERT OR IGNORE INTO orphan_files (file_key, delete_after) SELECT file_key, ?2 FROM notes WHERE team_id = ?1 AND file_key IS NOT NULL').bind(user.teamId, ctx.now),
      db.prepare('INSERT OR IGNORE INTO orphan_files (file_key, delete_after) SELECT file_key, ?2 FROM requests WHERE team_id = ?1 AND file_key IS NOT NULL').bind(user.teamId, ctx.now),
      db.prepare('INSERT OR IGNORE INTO orphan_files (file_key, delete_after) SELECT brand_logo_key, ?2 FROM teams WHERE id = ?1 AND brand_logo_key IS NOT NULL').bind(user.teamId, ctx.now),
      db.prepare('DELETE FROM notes WHERE team_id = ?1').bind(user.teamId),
      db.prepare('DELETE FROM users WHERE id = ?1').bind(user.id),
      // Cascades to records, events, requests, usage and tokens.
      db.prepare('DELETE FROM teams WHERE id = ?1').bind(user.teamId),
    ]);
  } else {
    await db.prepare('DELETE FROM users WHERE id = ?1').bind(user.id).run();
  }
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(ctx.url, '', 0) });
}

export interface AccountSecurity {
  twoFactor: boolean;
  apiKeyPrefix: string | null;
  apiKeyCreatedAt: number | null;
  apiKeyLastUsedAt: number | null;
  termsVersion: string | null;
  termsAcceptedAt: number | null;
  trustedDevices: number;
}

export async function accountSecurity(db: D1Database, userId: string, now: number): Promise<AccountSecurity> {
  const row = await db
    .prepare(
      `SELECT two_factor, api_key_prefix, api_key_created_at, api_key_last_used_at, terms_version, terms_accepted_at,
              (SELECT COUNT(*) FROM trusted_devices d WHERE d.user_id = users.id AND d.expires_at > ?2) AS devices
         FROM users WHERE id = ?1`,
    )
    .bind(userId, now)
    .first<Record<string, string | number | null>>();
  return {
    twoFactor: row?.['two_factor'] === 1,
    apiKeyPrefix: (row?.['api_key_prefix'] as string | null) ?? null,
    apiKeyCreatedAt: (row?.['api_key_created_at'] as number | null) ?? null,
    apiKeyLastUsedAt: (row?.['api_key_last_used_at'] as number | null) ?? null,
    termsVersion: (row?.['terms_version'] as string | null) ?? null,
    termsAcceptedAt: (row?.['terms_accepted_at'] as number | null) ?? null,
    trustedDevices: Number(row?.['devices'] ?? 0),
  };
}

/** Turn two-factor sign-in on or off. Needs the password; enabling remembers this browser. */
export async function handleTwoFactor(ctx: Ctx): Promise<Response> {
  const user = ctx.user!;
  const input = await parseBody(ctx, z.strictObject({ enabled: z.boolean(), authKey: authKeySchema }));
  if (input instanceof Response) return input;
  if (!(await checkAuthKey(ctx, user.id, input.authKey))) {
    return error(403, 'invalid_credentials', 'That password is incorrect.');
  }
  await audit(ctx, input.enabled ? 'security.2fa_on' : 'security.2fa_off');
  if (input.enabled) {
    await ctx.env.DB.prepare('UPDATE users SET two_factor = 1 WHERE id = ?1').bind(user.id).run();
    // This browser already proved itself with the password and an existing session.
    return json({ ok: true, enabled: true }, 200, { 'Set-Cookie': await trustDevice(ctx, user.id) });
  }
  await ctx.env.DB.batch([
    ctx.env.DB.prepare('UPDATE users SET two_factor = 0 WHERE id = ?1').bind(user.id),
    ctx.env.DB.prepare('DELETE FROM trusted_devices WHERE user_id = ?1').bind(user.id),
    ctx.env.DB.prepare('DELETE FROM login_challenges WHERE user_id = ?1').bind(user.id),
  ]);
  return json({ ok: true, enabled: false });
}

/** Forget every remembered browser: the next sign-in on each one needs an email code. */
export async function handleForgetDevices(ctx: Ctx): Promise<Response> {
  await ctx.env.DB.prepare('DELETE FROM trusted_devices WHERE user_id = ?1').bind(ctx.user!.id).run();
  return noContent();
}

/**
 * Create (or replace) the personal API key. Shown once; only its SHA-256 is stored. Needs the
 * password, since a key acts as the user.
 */
export async function handleCreateApiKey(ctx: Ctx): Promise<Response> {
  const user = ctx.user!;
  const input = await parseBody(ctx, z.strictObject({ authKey: authKeySchema }));
  if (input instanceof Response) return input;
  if (!(await checkAuthKey(ctx, user.id, input.authKey))) {
    return error(403, 'invalid_credentials', 'That password is incorrect.');
  }
  const key = `vn_${toBase64Url(randomBytes(32))}`;
  const prefix = key.slice(0, 10);
  await ctx.env.DB.prepare(
    'UPDATE users SET api_key_hash = ?2, api_key_prefix = ?3, api_key_created_at = ?4, api_key_last_used_at = NULL WHERE id = ?1',
  )
    .bind(user.id, await sha256Hex(key), prefix, ctx.now)
    .run();
  await audit(ctx, 'api_key.created', prefix);
  return json({ key, prefix, createdAt: ctx.now }, 201);
}

export async function handleRevokeApiKey(ctx: Ctx): Promise<Response> {
  const revoked = await ctx.env.DB.prepare(
    'UPDATE users SET api_key_hash = NULL, api_key_prefix = NULL, api_key_created_at = NULL, api_key_last_used_at = NULL WHERE id = ?1 AND api_key_hash IS NOT NULL',
  )
    .bind(ctx.user!.id)
    .run();
  if (revoked.meta.changes > 0) await audit(ctx, 'api_key.revoked');
  return noContent();
}

/** Record acceptance of the current terms and privacy policy (LEGAL_UPDATED is the version). */
export async function handleConsent(ctx: Ctx): Promise<Response> {
  const input = await parseBody(ctx, z.strictObject({ accept: z.literal(true) }));
  if (input instanceof Response) return input;
  await ctx.env.DB.prepare('UPDATE users SET terms_version = ?2, terms_accepted_at = ?3 WHERE id = ?1')
    .bind(ctx.user!.id, LEGAL_UPDATED, ctx.now)
    .run();
  return json({ version: LEGAL_UPDATED, acceptedAt: ctx.now });
}

const pushSchema = z.strictObject({
  endpoint: z.string().url().max(2048),
  keys: z.strictObject({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  }),
});

export async function handlePushSubscribe(ctx: Ctx): Promise<Response> {
  const input = await parseBody(ctx, pushSchema);
  if (input instanceof Response) return input;
  if (!isAllowedPushEndpoint(input.endpoint)) return error(400, 'invalid_request', 'This browser’s push service isn’t supported.');
  await ctx.env.DB.prepare(
    `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = ?2, p256dh = ?3, auth = ?4`,
  )
    .bind(input.endpoint, ctx.user!.id, input.keys.p256dh, input.keys.auth, ctx.now)
    .run();
  return noContent();
}

export async function handlePushUnsubscribe(ctx: Ctx): Promise<Response> {
  const input = await parseBody(ctx, z.strictObject({ endpoint: z.string().url().max(2048) }));
  if (input instanceof Response) return input;
  await ctx.env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?1 AND user_id = ?2').bind(input.endpoint, ctx.user!.id).run();
  return noContent();
}

export async function handlePushTest(ctx: Ctx): Promise<Response> {
  if (!ctx.env.VAPID_PRIVATE_KEY) return error(503, 'unavailable', 'Push notifications aren’t configured on this server.');
  notifyUser(ctx.env, ctx.user!.id, null, { title: 'Notifications are on', body: 'This is how we’ll tell you a note was opened.', url: '/app/settings' }, ctx.now, ctx.waitUntil);
  return noContent();
}

export async function handleContact(ctx: Ctx): Promise<Response> {
  const user = ctx.user!;
  const input = await parseBody(
    ctx,
    z.strictObject({ subject: z.string().trim().min(1).max(150), message: z.string().trim().min(1).max(5000) }),
  );
  if (input instanceof Response) return input;
  const mailer = createMailer(ctx.env);
  if (!mailer) return error(503, 'unavailable', `Email isn’t configured. Write to ${CONTACT_EMAIL} instead.`);
  await mailer(
    contactEmail(CONTACT_EMAIL, { name: user.name, email: user.email, team: user.teamName, plan: PLANS[user.plan].name }, input.subject, input.message),
  );
  return noContent();
}

/** Local development only: read emails written to the dev outbox. */
export async function handleDevOutbox(ctx: Ctx): Promise<Response> {
  if (ctx.env.DEV_OUTBOX !== 'true' || !isLocalRequest(ctx.url)) return notFound();
  const to = ctx.url.searchParams.get('to');
  const rows = await ctx.env.DB.prepare(
    'SELECT id, to_email, subject, text, created_at FROM dev_outbox WHERE (?1 IS NULL OR to_email = ?1) ORDER BY id DESC LIMIT 20',
  )
    .bind(to)
    .all();
  return json({ emails: rows.results });
}

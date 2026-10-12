/** Account settings, push devices, contact form, and the local-only dev outbox. */
import { z } from 'zod';
import { CONTACT_EMAIL } from '../lib/site';
import { PLANS } from '../lib/plans';
import { authKeySchema, checkAuthKey, hashAuthKey, nameSchema, parseBody, sessionCookie } from './auth';
import { isLocalRequest, type Ctx } from './context';
import { randomBytes, toBase64Url } from '../lib/encoding';
import { error, json, noContent, notFound } from './http';
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

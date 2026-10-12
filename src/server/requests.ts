/**
 * Information requests. The requester's browser makes an ECDH key pair and wraps the private
 * key with a request password; we store the public key and the wrapped private key. The
 * responder's browser encrypts to the public key. We can't read the response.
 */
import { z } from 'zod';
import { base64UrlLength, fromBase64Url, toBase64Url } from '../lib/encoding';
import {
  GCM_TAG_BYTES,
  IV_BYTES,
  MAX_CIPHERTEXT_CHARS,
  MAX_FILE_META_CHARS,
  MAX_HINT_CHARS,
  MAX_MESSAGE_CHARS,
  MAX_TITLE_CHARS,
  NOTE_ID_RE,
  SALT_BYTES,
} from '../lib/limits';
import { isPlanId, PLANS, type PlanId } from '../lib/plans';
import { newId, parseBody, type SessionUser } from './auth';
import { appLink, type Ctx } from './context';
import { ORPHAN_GRACE_MS } from './db';
import { BodyError, error, json, notFound, readMultipart } from './http';
import { createMailer, sendInBackground } from './mail';
import { notifyUser } from './notify';
import { eventStatement, issueDownloadGrant, retainUntil, visibleRecord } from './records';
import { requestCompletedEmail, requestForRecipientEmail } from './templates';
import { refundQuota, useQuota } from './usage';
import { teamBrand } from './account-notes';

const b64url = (length: number) => z.string().regex(new RegExp(`^[A-Za-z0-9_-]{${length}}$`));
const ivSchema = b64url(base64UrlLength(IV_BYTES));
const publicKeySchema = b64url(base64UrlLength(65)); // uncompressed P-256 point

export const createRequestSchema = z.strictObject({
  title: z.string().trim().min(1).max(MAX_TITLE_CHARS),
  publicKey: publicKeySchema,
  wrappedKey: z.string().regex(/^[A-Za-z0-9_-]+$/).min(100).max(400),
  wrappedKeyIv: ivSchema,
  wrappedKeySalt: b64url(base64UrlLength(SALT_BYTES)),
  message: z.string().trim().max(MAX_MESSAGE_CHARS).optional(),
  passwordHint: z.string().trim().max(MAX_HINT_CHARS).optional(),
  recipientEmail: z.email().max(254).optional(),
});

export const respondSchema = z.strictObject({
  response: z.string().regex(/^[A-Za-z0-9_-]+$/).min(base64UrlLength(GCM_TAG_BYTES)).max(MAX_CIPHERTEXT_CHARS),
  responseIv: ivSchema,
  epk: publicKeySchema,
  file: z
    .strictObject({ iv: ivSchema, meta: z.string().regex(/^[A-Za-z0-9_-]+$/).max(MAX_FILE_META_CHARS), metaIv: ivSchema })
    .optional(),
});

export async function fingerprint(publicKey: string): Promise<string> {
  return toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', fromBase64Url(publicKey))));
}

export function requestPath(user: { plan: PlanId; brandId: string | null }, id: string): string {
  const branded = PLANS[user.plan].limits.branding && user.brandId;
  return `/r/${id}${branded ? `?b=${user.brandId}` : ''}`;
}

export async function handleCreateRequest(ctx: Ctx): Promise<Response> {
  const user = ctx.user!;
  const plan = PLANS[user.plan];
  const input = await parseBody(ctx, createRequestSchema);
  if (input instanceof Response) return input;

  if (!(await useQuota(ctx.env.DB, user.teamId, 'requests', plan.limits.requestsPerMonth, ctx.now))) {
    return error(
      403,
      'quota_reached',
      `You’ve used all ${plan.limits.requestsPerMonth} information requests for this month. Upgrade for unlimited requests.`,
    );
  }

  const id = newId();
  const expiresAt = retainUntil(user.plan, ctx.now);
  const statements = [
    ctx.env.DB.prepare(
      `INSERT INTO requests (id, team_id, public_key, wrapped_key, wrapped_key_iv, wrapped_key_salt, message, password_hint, expires_at, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
    ).bind(
      id,
      user.teamId,
      input.publicKey,
      input.wrappedKey,
      input.wrappedKeyIv,
      input.wrappedKeySalt,
      input.message || null,
      input.passwordHint || null,
      expiresAt,
      ctx.now,
    ),
    ctx.env.DB.prepare(
      `INSERT INTO records (id, kind, team_id, user_id, title, status, has_file, created_at, expires_at, retain_until, updated_at)
       VALUES (?1, 'request', ?2, ?3, ?4, 'pending', 0, ?5, ?6, ?6, ?5)`,
    ).bind(id, user.teamId, user.id, input.title, ctx.now, expiresAt),
    eventStatement(ctx.env.DB, id, 'created', ctx.now, ctx.country),
  ];
  if (input.recipientEmail) statements.push(eventStatement(ctx.env.DB, id, 'emailed', ctx.now, null));
  try {
    await ctx.env.DB.batch(statements);
  } catch (err) {
    await refundQuota(ctx.env.DB, user.teamId, 'requests', ctx.now);
    throw err;
  }

  const path = `${requestPath(user, id)}#${await fingerprint(input.publicKey)}`;
  if (input.recipientEmail) {
    sendInBackground(
      createMailer(ctx.env),
      requestForRecipientEmail(
        input.recipientEmail,
        user.name,
        input.title,
        input.message || null,
        appLink(ctx.env, path),
        await teamBrand(ctx, user),
      ),
      ctx.waitUntil,
    );
  }
  return json({ id, path, expiresAt }, 201);
}

export interface PublicRequest {
  id: string;
  title: string;
  message: string | null;
  requester: string;
  publicKey: string;
  plan: PlanId;
  attachmentBytes: number;
  brandId: string | null;
  brandName: string | null;
  hasLogo: boolean;
  expiresAt: number;
}

/** What the responder's page needs. Null for missing, answered or expired requests (same for all). */
export async function loadOpenRequest(db: D1Database, id: string, now: number): Promise<PublicRequest | null> {
  if (!NOTE_ID_RE.test(id)) return null;
  const row = await db
    .prepare(
      `SELECT q.id, r.title, q.message, u.name AS requester, q.public_key, t.plan, t.brand_id, t.brand_name, t.brand_logo_key, q.expires_at
         FROM requests q JOIN records r ON r.id = q.id JOIN teams t ON t.id = q.team_id LEFT JOIN users u ON u.id = r.user_id
        WHERE q.id = ?1 AND q.response IS NULL AND q.expires_at > ?2`,
    )
    .bind(id, now)
    .first<Record<string, string | number | null>>();
  if (!row) return null;
  const plan = isPlanId(row['plan']) ? row['plan'] : 'free';
  const branded = PLANS[plan].limits.branding;
  return {
    id: String(row['id']),
    title: String(row['title']),
    message: (row['message'] as string | null) ?? null,
    requester: String(row['requester'] ?? 'Someone'),
    publicKey: String(row['public_key']),
    plan,
    attachmentBytes: PLANS[plan].limits.attachmentBytes,
    brandId: branded ? ((row['brand_id'] as string | null) ?? null) : null,
    brandName: branded ? ((row['brand_name'] as string | null) ?? null) : null,
    hasLogo: branded && row['brand_logo_key'] != null,
    expiresAt: Number(row['expires_at']),
  };
}

export const REQUEST_GONE = 'This request is no longer available. It may have been answered already, or expired.';

/** Public: the responder submits once. A second submission (or a race) gets the generic 404. */
export async function handleRespond(ctx: Ctx, id: string): Promise<Response> {
  const request = await loadOpenRequest(ctx.env.DB, id, ctx.now);
  if (!request) return error(404, 'not_found', REQUEST_GONE);

  let input: z.infer<typeof respondSchema>;
  let file: File | null;
  try {
    const body = await readMultipart(ctx.request, request.attachmentBytes + GCM_TAG_BYTES + 256 * 1024);
    const parsed = respondSchema.safeParse(body.meta);
    if (!parsed.success) return error(400, 'invalid_request', 'The response could not be read. Please try again.');
    input = parsed.data;
    file = body.file;
  } catch (err) {
    if (err instanceof BodyError) return error(err.status, err.code, err.message);
    throw err;
  }
  if (Boolean(file) !== Boolean(input.file)) return error(400, 'invalid_request', 'Attachment details are incomplete.');
  if (file && file.size > request.attachmentBytes + GCM_TAG_BYTES) {
    return error(413, 'too_large', `Files can be up to ${request.attachmentBytes / 1024 / 1024} MB.`);
  }

  const fileKey = file ? `requests/${id}/${newId(8)}` : null;
  if (file && fileKey) await ctx.env.FILES.put(fileKey, await file.arrayBuffer());

  // Exactly one response: the WHERE clause only matches an unanswered, unexpired request.
  const updated = await ctx.env.DB.prepare(
    `UPDATE requests SET response = ?2, response_iv = ?3, response_epk = ?4, file_key = ?5, file_size = ?6,
            file_iv = ?7, file_meta = ?8, file_meta_iv = ?9, completed_at = ?10
      WHERE id = ?1 AND response IS NULL AND expires_at > ?10 RETURNING team_id`,
  )
    .bind(
      id,
      input.response,
      input.responseIv,
      input.epk,
      fileKey,
      file?.size ?? null,
      input.file?.iv ?? null,
      input.file?.meta ?? null,
      input.file?.metaIv ?? null,
      ctx.now,
    )
    .first<{ team_id: string }>();
  if (!updated) {
    if (fileKey) await ctx.env.FILES.delete(fileKey).catch(() => {});
    return error(404, 'not_found', REQUEST_GONE);
  }

  await ctx.env.DB.batch([
    ctx.env.DB.prepare("UPDATE records SET status = 'completed', has_file = ?2, updated_at = ?3 WHERE id = ?1").bind(
      id,
      file ? 1 : 0,
      ctx.now,
    ),
    eventStatement(ctx.env.DB, id, 'completed', ctx.now, ctx.country),
  ]);

  const owner = await ctx.env.DB.prepare(
    'SELECT u.id, u.email, r.title FROM records r JOIN users u ON u.id = r.user_id WHERE r.id = ?1',
  )
    .bind(id)
    .first<{ id: string; email: string; title: string }>();
  if (owner) {
    notifyUser(
      ctx.env,
      owner.id,
      requestCompletedEmail(owner.email, owner.title, appLink(ctx.env, '/app')),
      { title: `“${owner.title}” has been answered`, body: 'Open it from your dashboard with the request password.', url: '/app' },
      ctx.now,
      ctx.waitUntil,
    );
  }
  return json({ ok: true });
}

async function ownRequest(ctx: Ctx, user: SessionUser, id: string) {
  const record = await visibleRecord(ctx.env.DB, id, user.teamId, user.id, PLANS[user.plan].limits.sharedNotes);
  return record?.kind === 'request' ? record : null;
}

/** Step 1 (no side effects): the wrapped private key, so the browser can check the password first. */
export async function handleRequestKey(ctx: Ctx, id: string): Promise<Response> {
  const user = ctx.user!;
  if (!(await ownRequest(ctx, user, id))) return notFound();
  const row = await ctx.env.DB.prepare(
    `SELECT public_key, wrapped_key, wrapped_key_iv, wrapped_key_salt, password_hint, response IS NOT NULL AS answered
       FROM requests WHERE id = ?1 AND team_id = ?2`,
  )
    .bind(id, user.teamId)
    .first<Record<string, string | number | null>>();
  if (!row) return notFound();
  return json({
    publicKey: row['public_key'],
    wrappedKey: row['wrapped_key'],
    wrappedKeyIv: row['wrapped_key_iv'],
    wrappedKeySalt: row['wrapped_key_salt'],
    passwordHint: row['password_hint'] ?? undefined,
    answered: row['answered'] === 1,
  });
}

/** Step 2: hand over the response and shred it (single statement), issuing a file grant. */
export async function handleOpenRequest(ctx: Ctx, id: string): Promise<Response> {
  const user = ctx.user!;
  if (!(await ownRequest(ctx, user, id))) return notFound();
  const [, deleted] = await ctx.env.DB.batch<Record<string, string | number | null>>([
    ctx.env.DB.prepare(
      `INSERT OR IGNORE INTO orphan_files (file_key, delete_after)
       SELECT file_key, ?3 FROM requests WHERE id = ?1 AND team_id = ?2 AND response IS NOT NULL AND file_key IS NOT NULL`,
    ).bind(id, user.teamId, ctx.now + ORPHAN_GRACE_MS),
    ctx.env.DB.prepare(
      `DELETE FROM requests WHERE id = ?1 AND team_id = ?2 AND response IS NOT NULL
       RETURNING response, response_iv, response_epk, file_key, file_size, file_iv, file_meta, file_meta_iv`,
    ).bind(id, user.teamId),
  ]);
  const row = deleted?.results[0];
  if (!row) return notFound();

  const statements = [
    ctx.env.DB.prepare("UPDATE records SET status = 'opened', updated_at = ?2 WHERE id = ?1").bind(id, ctx.now),
    eventStatement(ctx.env.DB, id, 'opened', ctx.now, ctx.country),
  ];
  if (!PLANS[user.plan].limits.keepActivityAfterShred) {
    statements.push(ctx.env.DB.prepare('DELETE FROM record_events WHERE record_id = ?1').bind(id));
  }
  await ctx.env.DB.batch(statements);

  const result: Record<string, unknown> = {
    response: row['response'],
    responseIv: row['response_iv'],
    epk: row['response_epk'],
  };
  if (row['file_key']) {
    result['file'] = {
      size: row['file_size'],
      iv: row['file_iv'],
      meta: row['file_meta'],
      metaIv: row['file_meta_iv'],
      downloadToken: await issueDownloadGrant(ctx.env.DB, String(row['file_key']), id, ctx.now),
    };
  }
  return json(result);
}

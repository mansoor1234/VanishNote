/** Account notes: created from the dashboard, tracked as records with activity. */
import { z } from 'zod';
import { base64UrlLength } from '../lib/encoding';
import {
  GCM_TAG_BYTES,
  IV_BYTES,
  MAX_CIPHERTEXT_CHARS,
  MAX_FILE_META_CHARS,
  MAX_HINT_CHARS,
  MAX_READS,
  MAX_TITLE_CHARS,
  MIN_READS,
  NOTE_ID_RE,
  SALT_BYTES,
  TIMED_EXPIRY_DAYS,
  type TimedExpiry,
} from '../lib/limits';
import { PLANS } from '../lib/plans';
import { newId, parseBody, type SessionUser } from './auth';
import { appLink, type Ctx } from './context';
import { deleteTeamNote, insertNoteStatement, ORPHAN_GRACE_MS } from './db';
import { BodyError, error, json, noContent, notFound, readMultipart, sha256Hex } from './http';
import { createMailer, sendInBackground } from './mail';
import { eventStatement, listRecords, recordEvents, retainUntil, visibleRecord } from './records';
import { noteForRecipientEmail } from './templates';
import { refundQuota, useQuota } from './usage';

const DAY = 24 * 60 * 60 * 1000;
const b64url = (length: number) => z.string().regex(new RegExp(`^[A-Za-z0-9_-]{${length}}$`));
const ivSchema = b64url(base64UrlLength(IV_BYTES));

const fileSchema = z.strictObject({
  iv: ivSchema,
  meta: z.string().regex(/^[A-Za-z0-9_-]+$/).max(MAX_FILE_META_CHARS),
  metaIv: ivSchema,
});

export const accountNoteSchema = z.strictObject({
  ciphertext: z
    .string()
    .min(base64UrlLength(GCM_TAG_BYTES + 1))
    .max(MAX_CIPHERTEXT_CHARS)
    .regex(/^[A-Za-z0-9_-]+$/),
  iv: ivSchema,
  salt: b64url(base64UrlLength(SALT_BYTES)).optional(),
  title: z.string().trim().min(1).max(MAX_TITLE_CHARS),
  passwordHint: z.string().trim().max(MAX_HINT_CHARS).optional(),
  shred: z.discriminatedUnion('mode', [
    z.strictObject({ mode: z.literal('read'), maxReads: z.number().int().min(MIN_READS).max(MAX_READS) }),
    z.strictObject({
      mode: z.literal('time'),
      expiresIn: z.enum(Object.keys(TIMED_EXPIRY_DAYS) as [TimedExpiry]),
    }),
  ]),
  file: fileSchema.optional(),
});

/** Path (no key) for a note link, including the brand parameter for branded teams. */
export function notePath(user: SessionUser, id: string): string {
  const branded = PLANS[user.plan].limits.branding && user.brandId;
  return `/n/${id}${branded ? `?b=${user.brandId}` : ''}`;
}

export async function handleCreateAccountNote(ctx: Ctx): Promise<Response> {
  const user = ctx.user!;
  const plan = PLANS[user.plan];
  const maxBody = plan.limits.attachmentBytes + GCM_TAG_BYTES + 256 * 1024;

  let input: z.infer<typeof accountNoteSchema>;
  let file: File | null;
  try {
    const body = await readMultipart(ctx.request, maxBody);
    const parsed = accountNoteSchema.safeParse(body.meta);
    if (!parsed.success) {
      const fields = [...new Set(parsed.error.issues.map((i) => i.path.join('.') || '(root)'))];
      return error(400, 'invalid_request', `Please check: ${fields.join(', ')}.`);
    }
    input = parsed.data;
    file = body.file;
  } catch (err) {
    if (err instanceof BodyError) return error(err.status, err.code, err.message);
    throw err;
  }

  if (Boolean(file) !== Boolean(input.file)) return error(400, 'invalid_request', 'Attachment details are incomplete.');
  if (file && file.size > plan.limits.attachmentBytes + GCM_TAG_BYTES) {
    return error(413, 'too_large', `Attachments on the ${plan.name} plan can be up to ${plan.limits.attachmentBytes / 1024 / 1024} MB.`);
  }
  if (input.passwordHint && !input.salt) {
    return error(400, 'invalid_request', 'A password hint only makes sense with a password.');
  }

  const retentionMs = plan.limits.retentionDays * DAY;
  let expiresAt: number;
  if (input.shred.mode === 'time') {
    const ms = TIMED_EXPIRY_DAYS[input.shred.expiresIn] * DAY;
    if (ms > retentionMs) {
      return error(403, 'plan_limit', `The ${plan.name} plan keeps notes for up to ${plan.limits.retentionDays} days.`);
    }
    expiresAt = ctx.now + ms;
  } else {
    expiresAt = ctx.now + retentionMs;
  }

  if (!(await useQuota(ctx.env.DB, user.teamId, 'notes', plan.limits.notesPerMonth, ctx.now))) {
    return error(
      403,
      'quota_reached',
      `You’ve used all ${plan.limits.notesPerMonth} notes for this month. Upgrade for unlimited notes.`,
    );
  }

  const id = newId();
  const fileKey = file ? `notes/${id}/${newId(8)}` : null;
  try {
    if (file && fileKey) {
      await ctx.env.FILES.put(fileKey, await file.arrayBuffer(), { httpMetadata: { contentType: 'application/octet-stream' } });
    }
    await ctx.env.DB.batch([
      insertNoteStatement(ctx.env.DB, {
        id,
        ciphertext: input.ciphertext,
        iv: input.iv,
        salt: input.salt ?? null,
        readsLeft: input.shred.mode === 'read' ? input.shred.maxReads : 1,
        burnOnRead: input.shred.mode === 'read',
        expiresAt,
        notifyEmail: null,
        // Account notes are destroyed from the dashboard, so the anonymous delete token is unusable.
        deleteTokenHash: await sha256Hex(newId(32)),
        createdAt: ctx.now,
        teamId: user.teamId,
        passwordHint: input.passwordHint || null,
        file: file && fileKey && input.file ? { key: fileKey, size: file.size, ...input.file } : null,
      }),
      ctx.env.DB.prepare(
        `INSERT INTO records (id, kind, team_id, user_id, title, status, has_file, created_at, expires_at, retain_until, updated_at)
         VALUES (?1, 'note', ?2, ?3, ?4, 'active', ?5, ?6, ?7, ?8, ?6)`,
      ).bind(id, user.teamId, user.id, input.title, file ? 1 : 0, ctx.now, expiresAt, Math.max(expiresAt, retainUntil(user.plan, ctx.now))),
      eventStatement(ctx.env.DB, id, 'created', ctx.now, ctx.country),
    ]);
  } catch (err) {
    await refundQuota(ctx.env.DB, user.teamId, 'notes', ctx.now);
    if (fileKey) await ctx.env.FILES.delete(fileKey).catch(() => {});
    throw err;
  }

  return json({ id, path: notePath(user, id), expiresAt }, 201);
}

/**
 * Email the link to a recipient. The browser sends the link key so we can build the link; we
 * only allow this for password-protected notes, so the key alone can't open the note.
 */
export async function handleSendNote(ctx: Ctx, id: string): Promise<Response> {
  const user = ctx.user!;
  const input = await parseBody(
    ctx,
    z.strictObject({ recipientEmail: z.email().max(254), linkKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }),
  );
  if (input instanceof Response) return input;
  if (!NOTE_ID_RE.test(id)) return notFound();

  const note = await ctx.env.DB.prepare(
    `SELECT n.has_password, n.password_hint, r.title,
            (SELECT COUNT(*) FROM record_events e WHERE e.record_id = r.id AND e.type = 'emailed') AS emailed
       FROM notes n JOIN records r ON r.id = n.id WHERE n.id = ?1 AND n.team_id = ?2 AND r.user_id = ?3`,
  )
    .bind(id, user.teamId, user.id)
    .first<{ has_password: number; password_hint: string | null; title: string; emailed: number }>();
  if (!note) return notFound();
  if (note.has_password !== 1) {
    return error(400, 'password_required', 'Add a password to email a note: we never send a note that only needs the link.');
  }
  if (note.emailed > 0) return error(409, 'already_sent', 'This note has already been emailed.');

  const url = appLink(ctx.env, `${notePath(user, id)}#${input.linkKey}`);
  const brand = await teamBrand(ctx, user);
  sendInBackground(
    createMailer(ctx.env),
    noteForRecipientEmail(input.recipientEmail, user.name, note.title, url, note.password_hint, brand),
    ctx.waitUntil,
  );
  await eventStatement(ctx.env.DB, id, 'emailed', ctx.now, null).run();
  return noContent();
}

export async function teamBrand(ctx: Ctx, user: SessionUser) {
  if (!PLANS[user.plan].limits.branding || !user.brandName) return undefined;
  return {
    name: user.brandName,
    ...(user.hasLogo && user.brandId ? { logoUrl: appLink(ctx.env, `/brand/${user.brandId}/logo`) } : {}),
  };
}

export async function handleListRecords(ctx: Ctx): Promise<Response> {
  const user = ctx.user!;
  const kind = ctx.url.searchParams.get('kind');
  const rows = await listRecords(
    ctx.env.DB,
    user.teamId,
    user.id,
    PLANS[user.plan].limits.sharedNotes,
    kind === 'note' || kind === 'request' ? kind : null,
  );
  return json({ records: rows });
}

export async function handleRecordEvents(ctx: Ctx, id: string): Promise<Response> {
  const user = ctx.user!;
  const record = await visibleRecord(ctx.env.DB, id, user.teamId, user.id, PLANS[user.plan].limits.sharedNotes);
  if (!record) return notFound();
  return json({ record, events: await recordEvents(ctx.env.DB, id) });
}

/** Destroy a note or cancel a request, and delete its record and activity. */
export async function handleDeleteRecord(ctx: Ctx, id: string): Promise<Response> {
  const user = ctx.user!;
  const record = await visibleRecord(ctx.env.DB, id, user.teamId, user.id, PLANS[user.plan].limits.sharedNotes);
  if (!record) return notFound();
  if (record.user_id !== user.id && user.role !== 'owner') {
    return error(403, 'forbidden', 'Only the person who created this, or the team owner, can delete it.');
  }
  if (record.kind === 'note') {
    await deleteTeamNote(ctx.env.DB, id, user.teamId, ctx.now);
  } else {
    await ctx.env.DB.batch([
      ctx.env.DB.prepare(
        'INSERT OR IGNORE INTO orphan_files (file_key, delete_after) SELECT file_key, ?3 FROM requests WHERE id = ?1 AND team_id = ?2 AND file_key IS NOT NULL',
      ).bind(id, user.teamId, ctx.now),
      ctx.env.DB.prepare('DELETE FROM requests WHERE id = ?1 AND team_id = ?2').bind(id, user.teamId),
    ]);
  }
  await ctx.env.DB.prepare('DELETE FROM records WHERE id = ?1').bind(id).run();
  return noContent();
}

/**
 * The recipient's browser reports a failed password attempt (the server can't check passwords).
 * Only recorded for live notes, or shredded ones on plans that keep activity.
 */
export async function handleNoteEvent(ctx: Ctx, id: string): Promise<Response> {
  const input = await parseBody(ctx, z.strictObject({ type: z.literal('wrong_password') }));
  if (input instanceof Response) return input;
  if (!NOTE_ID_RE.test(id)) return noContent();
  const record = await ctx.env.DB.prepare(
    `SELECT r.status, t.plan,
            (SELECT COUNT(*) FROM record_events e WHERE e.record_id = r.id AND e.type = 'wrong_password') AS attempts
       FROM records r JOIN teams t ON t.id = r.team_id WHERE r.id = ?1 AND r.kind = 'note'`,
  )
    .bind(id)
    .first<{ status: string; plan: keyof typeof PLANS; attempts: number }>();
  const keeps = record && (record.status === 'active' || PLANS[record.plan]?.limits.keepActivityAfterShred);
  if (record && keeps && record.attempts < 50) {
    await eventStatement(ctx.env.DB, id, 'wrong_password', ctx.now, ctx.country).run();
  }
  // Always the same answer: this endpoint must not reveal whether a note exists.
  return noContent();
}

/**
 * Download an encrypted attachment with a single-use grant. For "after a set time" notes the
 * download also shreds the note.
 */
export async function handleDownload(ctx: Ctx, token: string): Promise<Response> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return notFound();
  const grant = await ctx.env.DB.prepare(
    'DELETE FROM download_grants WHERE token_hash = ?1 AND expires_at > ?2 RETURNING file_key, record_id',
  )
    .bind(await sha256Hex(token), ctx.now)
    .first<{ file_key: string; record_id: string | null }>();
  if (!grant) return notFound();
  const object = await ctx.env.FILES.get(grant.file_key);
  if (!object) return notFound();

  if (grant.record_id) {
    const id = grant.record_id;
    const record = await ctx.env.DB.prepare(
      `SELECT r.status, t.plan, (SELECT burn_on_read FROM notes WHERE id = r.id) AS burn_on_read
         FROM records r JOIN teams t ON t.id = r.team_id WHERE r.id = ?1`,
    )
      .bind(id)
      .first<{ status: string; plan: keyof typeof PLANS; burn_on_read: number | null }>();
    const live = record?.status === 'active' || record?.status === 'completed';
    const timed = record?.burn_on_read === 0;
    const statements: D1PreparedStatement[] = [];
    // Same rule as other activity: after shredding, only plans that keep activity record it.
    if (record && (live || timed || PLANS[record.plan]?.limits.keepActivityAfterShred)) {
      statements.push(eventStatement(ctx.env.DB, id, 'downloaded', ctx.now, ctx.country));
    }
    if (timed) {
      statements.push(
        ctx.env.DB.prepare('INSERT OR IGNORE INTO orphan_files (file_key, delete_after) VALUES (?1, ?2)').bind(
          grant.file_key,
          ctx.now + ORPHAN_GRACE_MS,
        ),
        ctx.env.DB.prepare('DELETE FROM notes WHERE id = ?1').bind(id),
        ctx.env.DB.prepare("UPDATE records SET status = 'shredded', updated_at = ?2 WHERE id = ?1").bind(id, ctx.now),
        eventStatement(ctx.env.DB, id, 'shredded', ctx.now, null),
      );
      if (record && !PLANS[record.plan]?.limits.keepActivityAfterShred) {
        statements.push(ctx.env.DB.prepare('DELETE FROM record_events WHERE record_id = ?1').bind(id));
      }
    }
    if (statements.length > 0) await ctx.env.DB.batch(statements);
  }

  return new Response(object.body, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(object.size),
      'Content-Disposition': 'attachment; filename="encrypted.bin"',
      'Cache-Control': 'no-store',
    },
  });
}

/** Teams: members, invitations and company branding. */
import { z } from 'zod';
import { maxUsersFor, PLANS } from '../lib/plans';
import { emailSchema, issueToken, newId, nameSchema, parseBody, tokenSchema, type SessionUser } from './auth';
import { appLink, type Ctx } from './context';
import { error, json, noContent, notFound, sha256Hex } from './http';
import { createMailer, sendInBackground } from './mail';
import { inviteEmail } from './templates';

const DAY = 24 * 60 * 60 * 1000;

function ownerOnly(user: SessionUser): Response | null {
  return user.role === 'owner' ? null : error(403, 'forbidden', 'Only the team owner can do that.');
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: 'owner' | 'member';
}

export async function teamMembers(db: D1Database, teamId: string): Promise<TeamMember[]> {
  const rows = await db
    .prepare("SELECT id, name, email, role FROM users WHERE team_id = ?1 ORDER BY role = 'owner' DESC, name")
    .bind(teamId)
    .all<TeamMember>();
  return rows.results;
}

export async function pendingInvites(db: D1Database, teamId: string, now: number) {
  const rows = await db
    .prepare("SELECT email, expires_at FROM email_tokens WHERE team_id = ?1 AND purpose = 'invite' AND expires_at > ?2 ORDER BY created_at")
    .bind(teamId, now)
    .all<{ email: string; expires_at: number }>();
  return rows.results;
}

async function seatsUsed(db: D1Database, teamId: string, now: number): Promise<number> {
  const row = await db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM users WHERE team_id = ?1)
            + (SELECT COUNT(*) FROM email_tokens WHERE team_id = ?1 AND purpose = 'invite' AND expires_at > ?2) AS used`,
    )
    .bind(teamId, now)
    .first<{ used: number }>();
  return row?.used ?? 0;
}

export async function handleInvite(ctx: Ctx): Promise<Response> {
  const user = ctx.user!;
  const denied = ownerOnly(user);
  if (denied) return denied;
  const input = await parseBody(ctx, z.strictObject({ email: emailSchema }));
  if (input instanceof Response) return input;

  const plan = PLANS[user.plan];
  const max = maxUsersFor(plan, user.seats);
  if (max !== null && (await seatsUsed(ctx.env.DB, user.teamId, ctx.now)) >= max) {
    return error(
      403,
      'seat_limit',
      user.plan === 'free'
        ? 'The Free plan is for one person. Upgrade to invite teammates.'
        : `All ${max} seats are in use. Add seats or remove someone first.`,
    );
  }
  const existing = await ctx.env.DB.prepare('SELECT team_id FROM users WHERE email = ?1').bind(input.email).first<{ team_id: string }>();
  if (existing?.team_id === user.teamId) return error(409, 'already_member', 'That person is already on your team.');
  await ctx.env.DB.prepare("DELETE FROM email_tokens WHERE team_id = ?1 AND purpose = 'invite' AND email = ?2")
    .bind(user.teamId, input.email)
    .run();

  const token = await issueToken(ctx, 'invite', input.email, 7 * DAY, { teamId: user.teamId });
  sendInBackground(
    createMailer(ctx.env),
    inviteEmail(input.email, user.name, user.teamName, appLink(ctx.env, `/join#${token}`)),
    ctx.waitUntil,
  );
  return noContent();
}

export async function handleRevokeInvite(ctx: Ctx): Promise<Response> {
  const user = ctx.user!;
  const denied = ownerOnly(user);
  if (denied) return denied;
  const input = await parseBody(ctx, z.strictObject({ email: emailSchema }));
  if (input instanceof Response) return input;
  await ctx.env.DB.prepare("DELETE FROM email_tokens WHERE team_id = ?1 AND purpose = 'invite' AND email = ?2")
    .bind(user.teamId, input.email)
    .run();
  return noContent();
}

/** Remove a member: they get a fresh personal Free team; what they created stays with this team. */
export async function handleRemoveMember(ctx: Ctx, memberId: string): Promise<Response> {
  const user = ctx.user!;
  const denied = ownerOnly(user);
  if (denied) return denied;
  if (memberId === user.id) return error(400, 'invalid_request', 'You can’t remove yourself. Transfer or delete the team instead.');
  const member = await ctx.env.DB.prepare('SELECT name FROM users WHERE id = ?1 AND team_id = ?2')
    .bind(memberId, user.teamId)
    .first<{ name: string }>();
  if (!member) return notFound();
  const teamId = newId();
  await ctx.env.DB.batch([
    ctx.env.DB.prepare('INSERT INTO teams (id, name, created_at) VALUES (?1, ?2, ?3)').bind(teamId, `${member.name}’s team`, ctx.now),
    ctx.env.DB.prepare("UPDATE users SET team_id = ?2, role = 'owner' WHERE id = ?1").bind(memberId, teamId),
    // Sign them out so their next request picks up the new team.
    ctx.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(memberId),
  ]);
  return noContent();
}

/** Peek at an invite (for the join page) without using it. */
export async function inviteDetails(db: D1Database, token: string, now: number) {
  return db
    .prepare(
      `SELECT e.email, t.name AS team_name FROM email_tokens e JOIN teams t ON t.id = e.team_id
        WHERE e.token_hash = ?1 AND e.purpose = 'invite' AND e.expires_at > ?2`,
    )
    .bind(await sha256Hex(token), now)
    .first<{ email: string; team_name: string }>();
}

/**
 * Join a team with an invitation. The user's history (records, live notes, requests) moves with
 * them, and their old solo team is deleted.
 */
export async function handleJoin(ctx: Ctx): Promise<Response> {
  const user = ctx.user!;
  const input = await parseBody(ctx, z.strictObject({ token: tokenSchema }));
  if (input instanceof Response) return input;
  const invite = await ctx.env.DB.prepare(
    "SELECT team_id, email FROM email_tokens WHERE token_hash = ?1 AND purpose = 'invite' AND expires_at > ?2",
  )
    .bind(await sha256Hex(input.token), ctx.now)
    .first<{ team_id: string; email: string }>();
  if (!invite) return error(400, 'invalid_token', 'This invitation has expired or was already used.');
  if (invite.email !== user.email) {
    return error(403, 'wrong_account', `This invitation is for ${invite.email}. Log in with that address to accept it.`);
  }
  if (invite.team_id === user.teamId) return error(409, 'already_member', 'You’re already on this team.');
  const others = await ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE team_id = ?1 AND id != ?2')
    .bind(user.teamId, user.id)
    .first<{ n: number }>();
  if ((others?.n ?? 0) > 0) {
    return error(409, 'team_has_members', 'You own a team with other members. Remove them before joining another team.');
  }

  const old = user.teamId;
  const target = invite.team_id;
  await ctx.env.DB.batch([
    ctx.env.DB.prepare("DELETE FROM email_tokens WHERE token_hash = ?1 AND purpose = 'invite'").bind(await sha256Hex(input.token)),
    ctx.env.DB.prepare('UPDATE records SET team_id = ?2 WHERE team_id = ?1').bind(old, target),
    ctx.env.DB.prepare('UPDATE notes SET team_id = ?2 WHERE team_id = ?1').bind(old, target),
    ctx.env.DB.prepare('UPDATE requests SET team_id = ?2 WHERE team_id = ?1').bind(old, target),
    ctx.env.DB.prepare("UPDATE users SET team_id = ?2, role = 'member' WHERE id = ?1").bind(user.id, target),
    ctx.env.DB.prepare('INSERT OR IGNORE INTO orphan_files (file_key, delete_after) SELECT brand_logo_key, ?2 FROM teams WHERE id = ?1 AND brand_logo_key IS NOT NULL').bind(old, ctx.now),
    ctx.env.DB.prepare('DELETE FROM teams WHERE id = ?1').bind(old),
  ]);
  return noContent();
}

export async function handleRenameTeam(ctx: Ctx): Promise<Response> {
  const user = ctx.user!;
  const denied = ownerOnly(user);
  if (denied) return denied;
  const input = await parseBody(ctx, z.strictObject({ name: nameSchema }));
  if (input instanceof Response) return input;
  await ctx.env.DB.prepare('UPDATE teams SET name = ?2 WHERE id = ?1').bind(user.teamId, input.name).run();
  return noContent();
}

// --- branding ----------------------------------------------------------------------------------

const MAX_LOGO_BYTES = 256 * 1024;

/** Identify a logo by its bytes, not its claimed type. SVG is refused (it can carry script). */
export function sniffImageType(bytes: Uint8Array): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

export async function handleBranding(ctx: Ctx): Promise<Response> {
  const user = ctx.user!;
  const denied = ownerOnly(user);
  if (denied) return denied;
  if (!PLANS[user.plan].limits.branding) {
    return error(403, 'plan_limit', 'Company branding is available on the Standard and Business plans.');
  }
  const declared = Number(ctx.request.headers.get('Content-Length') ?? 'NaN');
  if (!Number.isFinite(declared) || declared > MAX_LOGO_BYTES + 16 * 1024) {
    return error(413, 'too_large', 'Logos can be up to 256 KB.');
  }
  let form: FormData;
  try {
    form = await ctx.request.formData();
  } catch {
    return error(400, 'invalid_body', 'The upload could not be read.');
  }
  const parsedName = z.string().trim().min(1).max(80).safeParse(form.get('brandName'));
  if (!parsedName.success) return error(400, 'invalid_request', 'Enter your company name (up to 80 characters).');

  const brandId = user.brandId ?? newId(9);
  const logo = form.get('logo');
  let logoKey: string | null = null;
  let logoType: string | null = null;
  if (logo instanceof File && logo.size > 0) {
    if (logo.size > MAX_LOGO_BYTES) return error(413, 'too_large', 'Logos can be up to 256 KB.');
    const bytes = new Uint8Array(await logo.arrayBuffer());
    logoType = sniffImageType(bytes);
    if (!logoType) return error(415, 'unsupported_media_type', 'Upload a PNG, JPEG or WebP image.');
    logoKey = `brand/${user.teamId}/${newId(8)}`;
    await ctx.env.FILES.put(logoKey, bytes, { httpMetadata: { contentType: logoType } });
  }

  const statements = [];
  if (logoKey) {
    statements.push(
      ctx.env.DB.prepare(
        'INSERT OR IGNORE INTO orphan_files (file_key, delete_after) SELECT brand_logo_key, ?2 FROM teams WHERE id = ?1 AND brand_logo_key IS NOT NULL',
      ).bind(user.teamId, ctx.now),
      ctx.env.DB.prepare('UPDATE teams SET brand_logo_key = ?2, brand_logo_type = ?3 WHERE id = ?1').bind(user.teamId, logoKey, logoType),
    );
  }
  statements.push(
    ctx.env.DB.prepare('UPDATE teams SET brand_id = ?2, brand_name = ?3 WHERE id = ?1').bind(user.teamId, brandId, parsedName.data),
  );
  await ctx.env.DB.batch(statements);
  return json({ brandId });
}

export async function handleRemoveLogo(ctx: Ctx): Promise<Response> {
  const user = ctx.user!;
  const denied = ownerOnly(user);
  if (denied) return denied;
  await ctx.env.DB.batch([
    ctx.env.DB.prepare(
      'INSERT OR IGNORE INTO orphan_files (file_key, delete_after) SELECT brand_logo_key, ?2 FROM teams WHERE id = ?1 AND brand_logo_key IS NOT NULL',
    ).bind(user.teamId, ctx.now),
    ctx.env.DB.prepare('UPDATE teams SET brand_logo_key = NULL, brand_logo_type = NULL WHERE id = ?1').bind(user.teamId),
  ]);
  return noContent();
}

export interface PublicBrand {
  brandId: string;
  name: string;
  hasLogo: boolean;
}

/** Branding for a public page, or null if the brand doesn't exist or the plan doesn't include it. */
export async function loadBrand(db: D1Database, brandId: string | null): Promise<PublicBrand | null> {
  if (!brandId || !/^[A-Za-z0-9_-]{12}$/.test(brandId)) return null;
  const row = await db
    .prepare("SELECT brand_name, brand_logo_key FROM teams WHERE brand_id = ?1 AND plan != 'free' AND brand_name IS NOT NULL")
    .bind(brandId)
    .first<{ brand_name: string; brand_logo_key: string | null }>();
  return row ? { brandId, name: row.brand_name, hasLogo: row.brand_logo_key !== null } : null;
}

export async function handleLogo(ctx: Ctx, brandId: string): Promise<Response> {
  if (!/^[A-Za-z0-9_-]{12}$/.test(brandId)) return notFound();
  const row = await ctx.env.DB.prepare(
    "SELECT brand_logo_key, brand_logo_type FROM teams WHERE brand_id = ?1 AND plan != 'free' AND brand_logo_key IS NOT NULL",
  )
    .bind(brandId)
    .first<{ brand_logo_key: string; brand_logo_type: string }>();
  if (!row) return notFound();
  const object = await ctx.env.FILES.get(row.brand_logo_key);
  if (!object) return notFound();
  return new Response(object.body, {
    headers: {
      'Content-Type': row.brand_logo_type,
      'Cache-Control': 'public, max-age=3600',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Content-Type-Options': 'nosniff',
      // Emails load this from mail providers' image proxies.
      'Cross-Origin-Resource-Policy': 'cross-origin',
    },
  });
}

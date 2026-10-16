/**
 * Team audit log: who did what, for team owners on paid plans. Records names and titles only,
 * never note contents, keys or passwords. Kept for the plan's retention period (see cleanup.ts).
 */
import type { Ctx } from './context';

export const AUDIT_ACTIONS = {
  'user.signed_in': 'Signed in',
  'note.created': 'Created a note',
  'note.destroyed': 'Destroyed a note',
  'request.created': 'Created a request',
  'request.cancelled': 'Cancelled a request',
  'record.deleted': 'Deleted from history',
  'member.invited': 'Invited',
  'invite.revoked': 'Revoked an invitation for',
  'member.joined': 'Joined the team',
  'member.removed': 'Removed',
  'member.shredded': 'Shredded all live notes and requests of',
  'team.renamed': 'Renamed the team to',
  'branding.updated': 'Updated company branding',
  'branding.logo_removed': 'Removed the company logo',
  'policy.updated': 'Changed team policies',
  'security.2fa_on': 'Turned on two-factor sign-in',
  'security.2fa_off': 'Turned off two-factor sign-in',
  'api_key.created': 'Created an API key',
  'api_key.revoked': 'Revoked their API key',
  'sso.linked': 'Connected sign-in with',
  'sso.unlinked': 'Disconnected sign-in with',
} as const;

export type AuditAction = keyof typeof AUDIT_ACTIONS;

export interface AuditActor {
  teamId: string;
  id: string | null;
  name: string;
}

export function auditStatement(ctx: Ctx, actor: AuditActor, action: AuditAction, target: string | null = null) {
  return ctx.env.DB.prepare(
    'INSERT INTO audit_log (team_id, actor_id, actor_name, action, target, country, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)',
  ).bind(actor.teamId, actor.id, actor.name, action, target, ctx.country, ctx.now);
}

/** Record an action by the signed-in user. */
export async function audit(ctx: Ctx, action: AuditAction, target: string | null = null): Promise<void> {
  const user = ctx.user!;
  await auditStatement(ctx, { teamId: user.teamId, id: user.id, name: user.name }, action, target).run();
}

/** Record a sign-in, looking up the user's team. */
export async function auditSignIn(ctx: Ctx, userId: string, method: string): Promise<void> {
  const user = await ctx.env.DB.prepare('SELECT team_id, name FROM users WHERE id = ?1').bind(userId).first<{ team_id: string; name: string }>();
  if (user) await auditStatement(ctx, { teamId: user.team_id, id: userId, name: user.name }, 'user.signed_in', method).run();
}

export interface AuditEntry {
  id: number;
  actor_id: string | null;
  actor_name: string;
  action: AuditAction;
  target: string | null;
  country: string | null;
  created_at: number;
}

export async function listAudit(
  db: D1Database,
  teamId: string,
  options: { limit?: number; before?: number; actorId?: string | null } = {},
): Promise<AuditEntry[]> {
  const rows = await db
    .prepare(
      `SELECT id, actor_id, actor_name, action, target, country, created_at FROM audit_log
        WHERE team_id = ?1 AND (?2 IS NULL OR created_at < ?2) AND (?3 IS NULL OR actor_id = ?3)
        ORDER BY created_at DESC, id DESC LIMIT ?4`,
    )
    .bind(teamId, options.before ?? null, options.actorId ?? null, options.limit ?? 200)
    .all<AuditEntry>();
  return rows.results;
}

/** One CSV field: quoted, and with formula prefixes neutralised for spreadsheet apps. */
export function csvField(value: string | number | null): string {
  let text = value === null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function auditCsv(entries: AuditEntry[]): string {
  const header = ['Time (UTC)', 'Person', 'Action', 'Target', 'Country'];
  const lines = entries.map((e) =>
    [new Date(e.created_at).toISOString(), e.actor_name, AUDIT_ACTIONS[e.action] ?? e.action, e.target, e.country].map(csvField).join(','),
  );
  return [header.map(csvField).join(','), ...lines].join('\r\n') + '\r\n';
}

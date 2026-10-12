/** Monthly quotas (UTC calendar months), enforced atomically in one statement. */

export type QuotaKind = 'notes' | 'requests';

export function monthKey(now: number): string {
  return new Date(now).toISOString().slice(0, 7);
}

/**
 * Use one unit of quota. Returns false if the team is already at `limit` this month.
 * The increment only happens when the WHERE clause allows it, so concurrent requests can't
 * overshoot the limit.
 */
export async function useQuota(
  db: D1Database,
  teamId: string,
  kind: QuotaKind,
  limit: number | null,
  now: number,
): Promise<boolean> {
  const col = kind === 'notes' ? 'notes' : 'requests';
  const row = await db
    .prepare(
      `INSERT INTO usage (team_id, month, ${col}) VALUES (?1, ?2, 1)
       ON CONFLICT (team_id, month) DO UPDATE SET ${col} = ${col} + 1 WHERE usage.${col} < ?3
       RETURNING ${col} AS used`,
    )
    .bind(teamId, monthKey(now), limit ?? Number.MAX_SAFE_INTEGER)
    .first<{ used: number }>();
  return row !== null && (limit === null || row.used <= limit);
}

/** Give a unit back when the action it paid for failed. */
export async function refundQuota(db: D1Database, teamId: string, kind: QuotaKind, now: number): Promise<void> {
  const col = kind === 'notes' ? 'notes' : 'requests';
  await db
    .prepare(`UPDATE usage SET ${col} = MAX(${col} - 1, 0) WHERE team_id = ?1 AND month = ?2`)
    .bind(teamId, monthKey(now))
    .run();
}

export async function getUsage(db: D1Database, teamId: string, now: number): Promise<{ notes: number; requests: number }> {
  const row = await db
    .prepare('SELECT notes, requests FROM usage WHERE team_id = ?1 AND month = ?2')
    .bind(teamId, monthKey(now))
    .first<{ notes: number; requests: number }>();
  return { notes: row?.notes ?? 0, requests: row?.requests ?? 0 };
}

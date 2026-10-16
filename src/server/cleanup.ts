/** Hourly cron: enforce expiry and retention, and delete files nothing can reach any more. */
import { PLAN_ORDER, PLANS } from '../lib/plans';
import type { AppEnv } from './context';
import { purgeExpired } from './db';

const DAY = 24 * 60 * 60 * 1000;

export interface CleanupReport {
  notes: number;
  requests: number;
  records: number;
  files: number;
}

export async function runCleanup(env: Pick<AppEnv, 'DB' | 'FILES'>, now: number): Promise<CleanupReport> {
  const db = env.DB;
  const notes = await purgeExpired(db, now);

  const [, , , requests, records] = await db.batch([
    db.prepare(
      `INSERT OR IGNORE INTO orphan_files (file_key, delete_after)
       SELECT file_key, ?1 FROM requests WHERE expires_at <= ?1 AND file_key IS NOT NULL`,
    ).bind(now),
    db.prepare(
      `INSERT INTO record_events (record_id, type, created_at)
       SELECT id, 'expired', ?1 FROM requests WHERE expires_at <= ?1`,
    ).bind(now),
    db.prepare(
      `UPDATE records SET status = 'expired', updated_at = ?1
       WHERE kind = 'request' AND status IN ('pending', 'completed') AND id IN (SELECT id FROM requests WHERE expires_at <= ?1)`,
    ).bind(now),
    db.prepare('DELETE FROM requests WHERE expires_at <= ?1').bind(now),
    // Retention: the record and all its activity go (events cascade).
    db.prepare('DELETE FROM records WHERE retain_until <= ?1').bind(now),
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?1').bind(now),
    db.prepare('DELETE FROM email_tokens WHERE expires_at <= ?1').bind(now),
    db.prepare('DELETE FROM download_grants WHERE expires_at <= ?1').bind(now),
    db.prepare('DELETE FROM trusted_devices WHERE expires_at <= ?1').bind(now),
    db.prepare('DELETE FROM login_challenges WHERE expires_at <= ?1').bind(now),
    db.prepare('DELETE FROM dev_outbox WHERE created_at <= ?1').bind(now - 24 * 60 * 60 * 1000),
    // Audit log: kept for the team's plan retention.
    ...PLAN_ORDER.map((plan) =>
      db
        .prepare('DELETE FROM audit_log WHERE created_at <= ?1 AND team_id IN (SELECT id FROM teams WHERE plan = ?2)')
        .bind(now - PLANS[plan].limits.retentionDays * DAY, plan),
    ),
  ]);

  // Encrypted files whose note/request is gone and whose download window has passed.
  let files = 0;
  for (;;) {
    const due = await db
      .prepare('SELECT file_key FROM orphan_files WHERE delete_after <= ?1 LIMIT 500')
      .bind(now)
      .all<{ file_key: string }>();
    if (due.results.length === 0) break;
    const keys = due.results.map((r) => r.file_key);
    await env.FILES.delete(keys);
    await db.batch(keys.map((key) => db.prepare('DELETE FROM orphan_files WHERE file_key = ?1').bind(key)));
    files += keys.length;
    if (keys.length < 500) break;
  }

  return { notes, requests: requests?.meta.changes ?? 0, records: records?.meta.changes ?? 0, files };
}

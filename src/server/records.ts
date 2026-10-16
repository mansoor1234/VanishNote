/** Dashboard records (account notes and requests) and their activity history. */
import { PLANS, type PlanId } from '../lib/plans';
import { appLink, type AppEnv } from './context';
import type { ConsumedNote } from './db';
import { newId } from './auth';
import { sha256Hex } from './http';
import { notifyUser } from './notify';
import { noteOpenedEmail } from './templates';

export type EventType =
  | 'created'
  | 'emailed'
  | 'opened'
  | 'wrong_password'
  | 'downloaded'
  | 'shredded'
  | 'expired'
  | 'destroyed'
  | 'completed';

const DAY = 24 * 60 * 60 * 1000;

export function retainUntil(plan: PlanId, now: number): number {
  return now + PLANS[plan].limits.retentionDays * DAY;
}

export function eventStatement(db: D1Database, recordId: string, type: EventType, now: number, country: string | null) {
  return db
    .prepare('INSERT INTO record_events (record_id, type, country, created_at) VALUES (?1, ?2, ?3, ?4)')
    .bind(recordId, type, country, now);
}

export async function addEvent(db: D1Database, recordId: string, type: EventType, now: number, country: string | null) {
  await eventStatement(db, recordId, type, now, country).run();
}

/** Download grants: single-use, short-lived tokens for one encrypted attachment. */
export const GRANT_TTL_MS = 10 * 60 * 1000;

export async function issueDownloadGrant(db: D1Database, fileKey: string, recordId: string | null, now: number) {
  const token = newId(32);
  await db
    .prepare('INSERT INTO download_grants (token_hash, file_key, record_id, expires_at) VALUES (?1, ?2, ?3, ?4)')
    .bind(await sha256Hex(token), fileKey, recordId, now + GRANT_TTL_MS)
    .run();
  return token;
}

/**
 * After an account note is read: update its record, keep or drop activity per plan, notify the
 * sender, and issue a download grant for its attachment.
 */
export async function onAccountNoteRead(
  env: AppEnv,
  id: string,
  note: ConsumedNote,
  now: number,
  country: string | null,
  waitUntil: (promise: Promise<unknown>) => void,
): Promise<{ downloadToken?: string }> {
  const record = await env.DB.prepare(
    `SELECT r.title, r.user_id, t.plan, u.email FROM records r
       JOIN teams t ON t.id = r.team_id LEFT JOIN users u ON u.id = r.user_id WHERE r.id = ?1`,
  )
    .bind(id)
    .first<{ title: string; user_id: string | null; plan: PlanId; email: string | null }>();

  const shredded = note.reads_left === 0;
  const statements = [eventStatement(env.DB, id, 'opened', now, country)];
  if (shredded) {
    statements.push(
      env.DB.prepare("UPDATE records SET status = 'shredded', updated_at = ?2 WHERE id = ?1").bind(id, now),
      eventStatement(env.DB, id, 'shredded', now, null),
    );
    // Free plan: activity is removed when the note is shredded; the record shows only its final status.
    if (record && !PLANS[record.plan]?.limits.keepActivityAfterShred) {
      statements.push(env.DB.prepare('DELETE FROM record_events WHERE record_id = ?1').bind(id));
    }
  } else {
    statements.push(env.DB.prepare('UPDATE records SET updated_at = ?2 WHERE id = ?1').bind(id, now));
  }
  await env.DB.batch(statements);

  if (record?.user_id && record.email) {
    const dashboard = appLink(env, '/app');
    notifyUser(
      env,
      record.user_id,
      noteOpenedEmail(record.email, record.title, note.reads_left, dashboard),
      {
        title: `“${record.title}” was opened`,
        body: shredded ? 'It has now been shredded.' : 'Tap to see its activity.',
        url: '/app',
      },
      now,
      waitUntil,
    );
  }

  if (!note.file_key) return {};
  return { downloadToken: await issueDownloadGrant(env.DB, note.file_key, id, now) };
}

export interface RecordRow {
  id: string;
  kind: 'note' | 'request';
  title: string;
  status: string;
  has_file: number;
  created_at: number;
  expires_at: number;
  updated_at: number;
  user_id: string | null;
  author: string | null;
}

export async function listRecords(
  db: D1Database,
  teamId: string,
  userId: string,
  shared: boolean,
  kind: 'note' | 'request' | null,
  limit = 100,
  /** Shared plans only: show one team member's records. */
  memberId: string | null = null,
): Promise<RecordRow[]> {
  const rows = await db
    .prepare(
      `SELECT r.id, r.kind, r.title, r.status, r.has_file, r.created_at, r.expires_at, r.updated_at, r.user_id, u.name AS author
         FROM records r LEFT JOIN users u ON u.id = r.user_id
        WHERE r.team_id = ?1 AND (?5 = 1 OR r.user_id = ?2) AND (?3 IS NULL OR r.kind = ?3) AND (?6 IS NULL OR r.user_id = ?6)
        ORDER BY r.created_at DESC LIMIT ?4`,
    )
    .bind(teamId, userId, kind, limit, shared ? 1 : 0, shared ? memberId : null)
    .all<RecordRow>();
  return rows.results;
}

export async function recordEvents(db: D1Database, recordId: string) {
  const rows = await db
    .prepare('SELECT type, country, created_at FROM record_events WHERE record_id = ?1 ORDER BY created_at, id')
    .bind(recordId)
    .all<{ type: EventType; country: string | null; created_at: number }>();
  return rows.results;
}

/** A record the user may see: same team, and their own unless the plan shares notes. */
export async function visibleRecord(
  db: D1Database,
  id: string,
  teamId: string,
  userId: string,
  shared: boolean,
): Promise<RecordRow | null> {
  return db
    .prepare(
      `SELECT r.id, r.kind, r.title, r.status, r.has_file, r.created_at, r.expires_at, r.updated_at, r.user_id, NULL AS author
         FROM records r WHERE r.id = ?1 AND r.team_id = ?2 AND (?4 = 1 OR r.user_id = ?3)`,
    )
    .bind(id, teamId, userId, shared ? 1 : 0)
    .first<RecordRow>();
}

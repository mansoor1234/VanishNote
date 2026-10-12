/** D1 access for notes. Every state change is a single statement or one atomic batch. */

export interface NewNote {
  id: string;
  ciphertext: string;
  iv: string;
  salt: string | null;
  readsLeft: number;
  expiresAt: number;
  notifyEmail: string | null;
  deleteTokenHash: string;
  createdAt: number;
  /** Account notes only. */
  teamId?: string;
  passwordHint?: string | null;
  burnOnRead?: boolean;
  file?: { key: string; size: number; iv: string; meta: string; metaIv: string } | null;
}

export interface ConsumedNote {
  ciphertext: string;
  iv: string;
  salt: string | null;
  has_password: number;
  notify_email: string | null;
  team_id: string | null;
  password_hint: string | null;
  file_key: string | null;
  file_size: number | null;
  file_iv: string | null;
  file_meta: string | null;
  file_meta_iv: string | null;
  burn_on_read: number;
  expires_at: number;
  /** Reads remaining after this read. 0 = the row was deleted; -1 = time-based note (not counted). */
  reads_left: number;
}

const COLUMNS =
  'ciphertext, iv, salt, has_password, notify_email, team_id, password_hint, file_key, file_size, file_iv, file_meta, file_meta_iv, burn_on_read, expires_at';

/** Encrypted attachments stay downloadable this long after their note is gone (grants expire sooner). */
export const ORPHAN_GRACE_MS = 15 * 60 * 1000;

export function insertNoteStatement(db: D1Database, note: NewNote): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO notes (id, ciphertext, iv, salt, has_password, reads_left, expires_at, notify_email, delete_token_hash, created_at,
                          team_id, password_hint, burn_on_read, file_key, file_size, file_iv, file_meta, file_meta_iv)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)`,
    )
    .bind(
      note.id,
      note.ciphertext,
      note.iv,
      note.salt,
      note.salt === null ? 0 : 1,
      note.readsLeft,
      note.expiresAt,
      note.notifyEmail,
      note.deleteTokenHash,
      note.createdAt,
      note.teamId ?? null,
      note.passwordHint ?? null,
      note.burnOnRead === false ? 0 : 1,
      note.file?.key ?? null,
      note.file?.size ?? null,
      note.file?.iv ?? null,
      note.file?.meta ?? null,
      note.file?.metaIv ?? null,
    );
}

export async function insertNote(db: D1Database, note: NewNote): Promise<void> {
  await insertNoteStatement(db, note).run();
}

/**
 * Atomically consume one read of a note.
 *
 * The batch runs as a single transaction, and each statement is a single atomic write, so two
 * concurrent reads can never both succeed on the last remaining read:
 *  1. Last read (reads_left = 1): DELETE ... RETURNING — the row is gone in the same statement.
 *     (Just before it, the note's attachment, if any, is queued for deletion under the same condition.)
 *  2. Otherwise: UPDATE reads_left = reads_left - 1 ... RETURNING (never reaches 0, since the
 *     final read always takes branch 1).
 *  3. "After a set time" notes are read without being consumed until they expire.
 *  4. Expired rows are removed on sight (and their attachments queued), so they don't linger
 *     until the hourly cron.
 */
export async function consumeNote(db: D1Database, id: string, now: number): Promise<ConsumedNote | null> {
  const lastRead = 'id = ?1 AND burn_on_read = 1 AND reads_left <= 1 AND expires_at > ?2';
  const results = await db.batch<ConsumedNote>([
    db
      .prepare(
        `INSERT OR IGNORE INTO orphan_files (file_key, delete_after)
         SELECT file_key, ?3 FROM notes WHERE ${lastRead} AND file_key IS NOT NULL`,
      )
      .bind(id, now, now + ORPHAN_GRACE_MS),
    db.prepare(`DELETE FROM notes WHERE ${lastRead} RETURNING ${COLUMNS}, 0 AS reads_left`).bind(id, now),
    db
      .prepare(
        `UPDATE notes SET reads_left = reads_left - 1
         WHERE id = ?1 AND burn_on_read = 1 AND reads_left > 1 AND expires_at > ?2 RETURNING ${COLUMNS}, reads_left`,
      )
      .bind(id, now),
    db
      .prepare(`SELECT ${COLUMNS}, -1 AS reads_left FROM notes WHERE id = ?1 AND burn_on_read = 0 AND expires_at > ?2`)
      .bind(id, now),
    db
      .prepare(
        `INSERT OR IGNORE INTO orphan_files (file_key, delete_after)
         SELECT file_key, ?2 FROM notes WHERE id = ?1 AND expires_at <= ?2 AND file_key IS NOT NULL`,
      )
      .bind(id, now),
    db.prepare('DELETE FROM notes WHERE id = ?1 AND expires_at <= ?2').bind(id, now),
  ]);
  return results[1]?.results[0] ?? results[2]?.results[0] ?? results[3]?.results[0] ?? null;
}

/** Delete a note and queue its attachment for deletion. Returns the deleted row's team, or null. */
async function deleteWhere(
  db: D1Database,
  where: string,
  binds: unknown[],
  now: number,
): Promise<{ team_id: string | null } | null> {
  const n = binds.length;
  const [, deleted] = await db.batch<{ team_id: string | null }>([
    db
      .prepare(`INSERT OR IGNORE INTO orphan_files (file_key, delete_after) SELECT file_key, ?${n + 1} FROM notes WHERE ${where} AND file_key IS NOT NULL`)
      .bind(...binds, now),
    db.prepare(`DELETE FROM notes WHERE ${where} RETURNING team_id`).bind(...binds),
  ]);
  return deleted?.results[0] ?? null;
}

/** Delete a note early using the creator's delete token. Returns true if a row was removed. */
export async function deleteNoteWithToken(
  db: D1Database,
  id: string,
  tokenHash: string,
  now = Date.now(),
): Promise<boolean> {
  return (await deleteWhere(db, 'id = ?1 AND delete_token_hash = ?2', [id, tokenHash], now)) !== null;
}

/** Destroy a team's note from the dashboard. */
export async function deleteTeamNote(db: D1Database, id: string, teamId: string, now: number): Promise<boolean> {
  return (await deleteWhere(db, 'id = ?1 AND team_id = ?2', [id, teamId], now)) !== null;
}

/** Remove every expired note (queuing attachments) and mark account records expired. Used by the cron. */
export async function purgeExpired(db: D1Database, now: number): Promise<number> {
  const [, , , deleted] = await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO orphan_files (file_key, delete_after)
         SELECT file_key, ?1 FROM notes WHERE expires_at <= ?1 AND file_key IS NOT NULL`,
      )
      .bind(now),
    db
      .prepare(
        `INSERT INTO record_events (record_id, type, created_at)
         SELECT r.id, 'expired', ?1 FROM records r JOIN notes n ON n.id = r.id WHERE n.expires_at <= ?1`,
      )
      .bind(now),
    db
      .prepare(
        `UPDATE records SET status = 'expired', updated_at = ?1
         WHERE kind = 'note' AND status = 'active' AND id IN (SELECT id FROM notes WHERE expires_at <= ?1)`,
      )
      .bind(now),
    db.prepare('DELETE FROM notes WHERE expires_at <= ?1').bind(now),
  ]);
  return deleted?.meta.changes ?? 0;
}

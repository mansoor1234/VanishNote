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
}

export interface ConsumedNote {
  ciphertext: string;
  iv: string;
  salt: string | null;
  has_password: number;
  notify_email: string | null;
  /** Reads remaining after this read. 0 means the row was deleted. */
  reads_left: number;
}

const RETURNING = 'RETURNING ciphertext, iv, salt, has_password, notify_email';

export async function insertNote(db: D1Database, note: NewNote): Promise<void> {
  await db
    .prepare(
      `INSERT INTO notes (id, ciphertext, iv, salt, has_password, reads_left, expires_at, notify_email, delete_token_hash, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
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
    )
    .run();
}

/**
 * Atomically consume one read of a note.
 *
 * The batch runs as a single transaction, and each statement is a single atomic
 * write, so two concurrent reads can never both succeed on the last remaining read:
 *  1. Last read (reads_left = 1): DELETE ... RETURNING — the row is gone in the same statement.
 *  2. Otherwise: UPDATE reads_left = reads_left - 1 ... RETURNING (never reaches 0, since
 *     the final read always takes branch 1).
 *  3. Opportunistically delete the row if it has already expired, so expired notes
 *     do not linger until the hourly cron.
 * At most one of (1) and (2) can match; (3) only matches rows that (1)/(2) rejected.
 */
export async function consumeNote(db: D1Database, id: string, now: number): Promise<ConsumedNote | null> {
  const [deleted, decremented] = await db.batch<ConsumedNote>([
    db
      .prepare(`DELETE FROM notes WHERE id = ?1 AND reads_left <= 1 AND expires_at > ?2 ${RETURNING}, 0 AS reads_left`)
      .bind(id, now),
    db
      .prepare(
        `UPDATE notes SET reads_left = reads_left - 1 WHERE id = ?1 AND reads_left > 1 AND expires_at > ?2 ${RETURNING}, reads_left`,
      )
      .bind(id, now),
    db.prepare('DELETE FROM notes WHERE id = ?1 AND expires_at <= ?2').bind(id, now),
  ]);
  return deleted?.results[0] ?? decremented?.results[0] ?? null;
}

/** Delete a note early using the creator's delete token. Returns true if a row was removed. */
export async function deleteNoteWithToken(db: D1Database, id: string, tokenHash: string): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM notes WHERE id = ?1 AND delete_token_hash = ?2')
    .bind(id, tokenHash)
    .run();
  return result.meta.changes > 0;
}

/** Remove every expired note. Used by the cron trigger. */
export async function purgeExpired(db: D1Database, now: number): Promise<number> {
  const result = await db.prepare('DELETE FROM notes WHERE expires_at <= ?1').bind(now).run();
  return result.meta.changes;
}

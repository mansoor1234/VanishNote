-- Encrypted notes. The server only ever holds ciphertext; keys live in the URL fragment.
CREATE TABLE notes (
  id                TEXT PRIMARY KEY,           -- 128-bit random, base64url
  ciphertext        TEXT NOT NULL,              -- AES-256-GCM output, base64url
  iv                TEXT NOT NULL,              -- 96-bit IV, base64url
  salt              TEXT,                       -- PBKDF2 salt when password-protected
  has_password      INTEGER NOT NULL DEFAULT 0 CHECK (has_password IN (0, 1)),
  reads_left        INTEGER NOT NULL CHECK (reads_left BETWEEN 1 AND 10),
  expires_at        INTEGER NOT NULL,           -- unix epoch milliseconds
  notify_email      TEXT,                       -- deleted together with the row
  delete_token_hash TEXT NOT NULL,              -- SHA-256 hex of the creator's delete token
  created_at        INTEGER NOT NULL            -- unix epoch milliseconds
);

CREATE INDEX idx_notes_expires_at ON notes (expires_at);

-- Two-factor sign-in on unrecognised devices, personal API keys, and recorded terms consent.

ALTER TABLE users ADD COLUMN two_factor INTEGER NOT NULL DEFAULT 0;
-- API key: only a SHA-256 is stored; the prefix is shown so the user can recognise it.
ALTER TABLE users ADD COLUMN api_key_hash TEXT;
ALTER TABLE users ADD COLUMN api_key_prefix TEXT;
ALTER TABLE users ADD COLUMN api_key_created_at INTEGER;
ALTER TABLE users ADD COLUMN api_key_last_used_at INTEGER;
-- Version (the LEGAL_UPDATED date) and time of the terms and privacy policy the user accepted.
ALTER TABLE users ADD COLUMN terms_version TEXT;
ALTER TABLE users ADD COLUMN terms_accepted_at INTEGER;

CREATE UNIQUE INDEX idx_users_api_key ON users (api_key_hash);

-- Devices that completed a sign-in (cookie token, stored hashed). Skips the email code next time.
CREATE TABLE trusted_devices (
  token_hash   TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);
CREATE INDEX idx_trusted_devices_user ON trusted_devices (user_id);
CREATE INDEX idx_trusted_devices_expires ON trusted_devices (expires_at);

-- Pending email-code sign-ins. The code is stored hashed; 5 attempts, 10 minutes.
CREATE TABLE login_challenges (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  TEXT NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_login_challenges_expires ON login_challenges (expires_at);

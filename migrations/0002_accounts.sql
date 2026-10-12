-- Accounts, teams, dashboard records, information requests, usage and push.
-- All timestamps are unix epoch milliseconds.

-- Every user belongs to exactly one team. Sign-up creates a personal team (the user is its owner).
-- The plan lives on the team. Billing isn't wired up yet: plan/seats are set by an operator.
CREATE TABLE teams (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  plan           TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'standard', 'business')),
  seats          INTEGER NOT NULL DEFAULT 1 CHECK (seats >= 1),
  brand_id       TEXT UNIQUE,                    -- public id used in branded links and logo URLs
  brand_name     TEXT,
  brand_logo_key TEXT,                           -- R2 key of the logo
  brand_logo_type TEXT,
  created_at     INTEGER NOT NULL
);

CREATE TABLE users (
  id                TEXT PRIMARY KEY,
  team_id           TEXT NOT NULL REFERENCES teams(id),
  role              TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'member')),
  email             TEXT NOT NULL UNIQUE,         -- lower-cased
  name              TEXT NOT NULL,
  -- The browser sends authKey = HKDF(PBKDF2-SHA256(password, 600k)); we store SHA-256(salt || authKey).
  auth_salt         TEXT NOT NULL,
  auth_hash         TEXT NOT NULL,
  email_verified_at INTEGER,
  created_at        INTEGER NOT NULL
);
CREATE INDEX idx_users_team ON users (team_id);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,                    -- SHA-256 of the cookie value
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions (user_id);
CREATE INDEX idx_sessions_expires ON sessions (expires_at);

-- Single-use emailed tokens: email verification, password reset, team invitations.
CREATE TABLE email_tokens (
  token_hash TEXT PRIMARY KEY,
  purpose    TEXT NOT NULL CHECK (purpose IN ('verify', 'reset', 'invite')),
  user_id    TEXT REFERENCES users(id) ON DELETE CASCADE,
  team_id    TEXT REFERENCES teams(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_email_tokens_expires ON email_tokens (expires_at);
CREATE INDEX idx_email_tokens_team ON email_tokens (team_id, purpose);

-- Account notes reuse the `notes` table for the burn-after-read payload, plus a few columns.
ALTER TABLE notes ADD COLUMN team_id TEXT;
ALTER TABLE notes ADD COLUMN password_hint TEXT;
ALTER TABLE notes ADD COLUMN file_key TEXT;      -- R2 key of the encrypted attachment
ALTER TABLE notes ADD COLUMN file_size INTEGER;  -- ciphertext bytes
ALTER TABLE notes ADD COLUMN file_meta TEXT;     -- encrypted {name,type}, base64url
ALTER TABLE notes ADD COLUMN file_meta_iv TEXT;
ALTER TABLE notes ADD COLUMN file_iv TEXT;
-- 1 = destroyed after reads_left views; 0 = "after a set time": readable until expires_at.
ALTER TABLE notes ADD COLUMN burn_on_read INTEGER NOT NULL DEFAULT 1;

-- Dashboard metadata for account notes and requests. Outlives the encrypted payload
-- (which is deleted on read) so the sender can see what happened, until retention ends.
CREATE TABLE records (
  id          TEXT PRIMARY KEY,                   -- equals notes.id / requests.id
  kind        TEXT NOT NULL CHECK (kind IN ('note', 'request')),
  team_id     TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,                      -- plaintext metadata, never the secret
  status      TEXT NOT NULL,                      -- note: active|shredded|expired|destroyed; request: pending|completed|opened|expired|destroyed
  has_file    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,                   -- when the payload expires
  retain_until INTEGER NOT NULL,                  -- when this record and its activity are purged
  updated_at  INTEGER NOT NULL
);
CREATE INDEX idx_records_team ON records (team_id, created_at DESC);
CREATE INDEX idx_records_retain ON records (retain_until);

CREATE TABLE record_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id  TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,                       -- created|emailed|opened|wrong_password|downloaded|shredded|expired|destroyed|completed
  country    TEXT,                                -- two-letter country from Cloudflare, never an IP
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_record_events_record ON record_events (record_id, created_at);

-- Information requests: someone without an account fills in a form, encrypted to a public key
-- whose private key is wrapped with the requester's request password (never sent to us).
CREATE TABLE requests (
  id                TEXT PRIMARY KEY,
  team_id           TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  public_key        TEXT NOT NULL,                -- ECDH P-256 raw public key, base64url
  wrapped_key       TEXT NOT NULL,                -- AES-GCM(PBKDF2(password)) of the PKCS#8 private key
  wrapped_key_iv    TEXT NOT NULL,
  wrapped_key_salt  TEXT NOT NULL,
  message           TEXT,                         -- plaintext instructions shown to the responder
  password_hint     TEXT,
  response          TEXT,                         -- AES-GCM ciphertext
  response_iv       TEXT,
  response_epk      TEXT,                         -- responder's ephemeral ECDH public key
  file_key          TEXT,
  file_size         INTEGER,
  file_iv           TEXT,
  file_meta         TEXT,
  file_meta_iv      TEXT,
  completed_at      INTEGER,
  expires_at        INTEGER NOT NULL,
  created_at        INTEGER NOT NULL
);
CREATE INDEX idx_requests_expires ON requests (expires_at);

-- Monthly usage counters per team (UTC month, "YYYY-MM").
CREATE TABLE usage (
  team_id  TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  month    TEXT NOT NULL,
  notes    INTEGER NOT NULL DEFAULT 0,
  requests INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (team_id, month)
);

-- One-time download grants for attachments, issued when a note is opened.
CREATE TABLE download_grants (
  token_hash TEXT PRIMARY KEY,
  file_key   TEXT NOT NULL,
  record_id  TEXT,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_download_grants_expires ON download_grants (expires_at);

-- R2 objects waiting to be deleted once no download grant can still reach them.
CREATE TABLE orphan_files (
  file_key    TEXT PRIMARY KEY,
  delete_after INTEGER NOT NULL
);

CREATE TABLE push_subscriptions (
  endpoint   TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_push_user ON push_subscriptions (user_id);

-- Local development only: emails are written here instead of being sent when DEV_OUTBOX=true.
CREATE TABLE dev_outbox (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  to_email   TEXT NOT NULL,
  subject    TEXT NOT NULL,
  text       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

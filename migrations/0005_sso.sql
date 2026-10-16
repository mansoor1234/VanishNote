-- Sign in with Google or Microsoft (OpenID Connect).

-- 0 for accounts created with Google/Microsoft: they have a random, unusable password hash until
-- the user sets a password through "Forgot password".
ALTER TABLE users ADD COLUMN has_password INTEGER NOT NULL DEFAULT 1;

-- Linked sign-in identities. `subject` is the provider's stable user id (Microsoft: tenant:sub).
CREATE TABLE user_identities (
  provider   TEXT NOT NULL CHECK (provider IN ('google', 'microsoft')),
  subject    TEXT NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,                    -- shown in Settings; the address the provider vouched for
  created_at INTEGER NOT NULL,
  PRIMARY KEY (provider, subject)
);
CREATE INDEX idx_user_identities_user ON user_identities (user_id);

-- In-flight sign-ins (10 minutes). The state is also set in a cookie, so a sign-in can only be
-- finished in the browser that started it. Stored hashed, single use.
CREATE TABLE sso_states (
  state_hash    TEXT PRIMARY KEY,
  provider      TEXT NOT NULL,
  mode          TEXT NOT NULL CHECK (mode IN ('login', 'signup', 'link')),
  nonce         TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  user_id       TEXT,                          -- mode 'link': the signed-in user
  next_path     TEXT,
  expires_at    INTEGER NOT NULL
);
CREATE INDEX idx_sso_states_expires ON sso_states (expires_at);

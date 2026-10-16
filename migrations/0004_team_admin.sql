-- Team admin (Standard and Business): policies and an audit log.

-- Policies the server enforces on every note and request a team member creates.
ALTER TABLE teams ADD COLUMN policy_require_password INTEGER NOT NULL DEFAULT 0;
-- Longest lifetime for notes and requests: a TIMED_EXPIRY_DAYS key ('1d', '7d', …), NULL = plan maximum.
ALTER TABLE teams ADD COLUMN policy_max_expiry TEXT;
-- Business: members (not the owner) must sign in with Google or Microsoft.
ALTER TABLE teams ADD COLUMN policy_require_sso INTEGER NOT NULL DEFAULT 0;

-- Who did what in the team. Titles and names only (never note contents, keys or passwords).
-- Kept for the plan's retention period.
CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id    TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  actor_id   TEXT,                 -- user id at the time (not a foreign key: kept if they leave)
  actor_name TEXT NOT NULL,
  action     TEXT NOT NULL,        -- see AUDIT_ACTIONS in src/server/audit.ts
  target     TEXT,                 -- e.g. a note title or a member's name
  country    TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_audit_team_time ON audit_log (team_id, created_at);
CREATE INDEX idx_audit_time ON audit_log (created_at);

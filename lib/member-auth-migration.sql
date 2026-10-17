-- Apply once to the existing D1 database before enabling the member gate.
CREATE TABLE IF NOT EXISTS rr_members (
  id TEXT PRIMARY KEY NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS rr_one_owner
  ON rr_members(role) WHERE role = 'owner';

CREATE TABLE IF NOT EXISTS rr_invites (
  token_hash TEXT PRIMARY KEY NOT NULL,
  member_id TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES rr_members(id),
  purpose TEXT NOT NULL CHECK (purpose IN ('member', 'device')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX IF NOT EXISTS rr_invites_expiry ON rr_invites(expires_at);

CREATE TABLE IF NOT EXISTS rr_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  member_id TEXT NOT NULL REFERENCES rr_members(id),
  device_label TEXT NOT NULL DEFAULT 'This device',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS rr_sessions_member ON rr_sessions(member_id, revoked_at);

CREATE TABLE IF NOT EXISTS rr_recovery_codes (
  token_hash TEXT PRIMARY KEY NOT NULL,
  member_id TEXT NOT NULL REFERENCES rr_members(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX IF NOT EXISTS rr_recovery_expiry ON rr_recovery_codes(expires_at, used_at);
CREATE UNIQUE INDEX IF NOT EXISTS rr_one_active_recovery
  ON rr_recovery_codes(member_id) WHERE used_at IS NULL;

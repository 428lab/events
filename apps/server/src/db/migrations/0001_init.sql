CREATE TABLE user (
  id TEXT PRIMARY KEY,
  discord_id TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL,
  global_name TEXT,
  avatar_url TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE session (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_session_user ON session(user_id);

CREATE TABLE event (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  venue_type TEXT NOT NULL,
  venue_offline TEXT,
  venue_online TEXT,
  participation_type TEXT NOT NULL DEFAULT 'individual',
  aggregate_self_entry INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by TEXT NOT NULL REFERENCES user(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_event_status ON event(status);

CREATE TABLE event_member (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'participant',
  created_at INTEGER NOT NULL,
  UNIQUE(event_id, user_id)
);
CREATE INDEX idx_event_member_event ON event_member(event_id);
CREATE INDEX idx_event_member_user ON event_member(user_id);

CREATE TABLE entry (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'individual',
  name TEXT NOT NULL,
  team_id TEXT,
  presentation_order INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_entry_event ON entry(event_id);

CREATE TABLE entry_member (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES entry(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  is_leader INTEGER NOT NULL DEFAULT 0,
  UNIQUE(entry_id, user_id)
);
CREATE INDEX idx_entry_member_entry ON entry_member(entry_id);
CREATE INDEX idx_entry_member_user ON entry_member(user_id);

CREATE TABLE submission (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL UNIQUE REFERENCES entry(id) ON DELETE CASCADE,
  presentation_url TEXT,
  source_code_url TEXT,
  updated_at INTEGER NOT NULL
);

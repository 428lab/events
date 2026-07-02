-- 日程調整（日程未定で公開できる。候補日に参加者が○△×→主催が確定）
ALTER TABLE event ADD COLUMN scheduling INTEGER NOT NULL DEFAULT 0;

CREATE TABLE event_date_option (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_date_option_event ON event_date_option(event_id);

CREATE TABLE event_date_vote (
  id TEXT PRIMARY KEY,
  option_id TEXT NOT NULL REFERENCES event_date_option(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  choice TEXT NOT NULL, -- 'yes' | 'maybe' | 'no'
  created_at INTEGER NOT NULL,
  UNIQUE (option_id, user_id)
);
CREATE INDEX idx_date_vote_option ON event_date_vote(option_id);
CREATE INDEX idx_date_vote_user ON event_date_vote(user_id);

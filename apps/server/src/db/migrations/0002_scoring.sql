CREATE TABLE scoring_criterion (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  max_level INTEGER NOT NULL DEFAULT 4
);
CREATE INDEX idx_criterion_event ON scoring_criterion(event_id);

CREATE TABLE score (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  entry_id TEXT NOT NULL REFERENCES entry(id) ON DELETE CASCADE,
  criterion_id TEXT NOT NULL REFERENCES scoring_criterion(id) ON DELETE CASCADE,
  judge_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  value INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(entry_id, criterion_id, judge_user_id)
);
CREATE INDEX idx_score_event ON score(event_id);
CREATE INDEX idx_score_entry ON score(entry_id);
CREATE INDEX idx_score_judge ON score(judge_user_id);

CREATE TABLE event_state (
  event_id TEXT PRIMARY KEY REFERENCES event(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'normal',
  presenting_entry_id TEXT REFERENCES entry(id) ON DELETE SET NULL,
  scoring_locked INTEGER NOT NULL DEFAULT 0,
  awards_reveal_cursor INTEGER,
  updated_at INTEGER NOT NULL
);

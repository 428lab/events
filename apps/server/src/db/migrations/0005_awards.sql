CREATE TABLE award_rank (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  content TEXT,
  rank_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_award_rank_event ON award_rank(event_id);

CREATE TABLE special_award (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  content TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_special_award_event ON special_award(event_id);

CREATE TABLE award_result (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  entry_id TEXT NOT NULL REFERENCES entry(id) ON DELETE CASCADE,
  award_rank_id TEXT REFERENCES award_rank(id) ON DELETE CASCADE,
  special_award_id TEXT REFERENCES special_award(id) ON DELETE CASCADE
);
CREATE INDEX idx_award_result_event ON award_result(event_id);

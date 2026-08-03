-- 参加者同士の「出会った」記録 (#189)。XP付与とオフライン交流の促進用
CREATE TABLE event_meet (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  user_low TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  user_high TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_event_meet_pair ON event_meet(event_id, user_low, user_high);
CREATE INDEX idx_event_meet_user_low ON event_meet(user_low);
CREATE INDEX idx_event_meet_user_high ON event_meet(user_high);

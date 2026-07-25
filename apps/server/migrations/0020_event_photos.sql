-- イベントフォト（参加者がアップロード。閲覧も参加者のみ）
CREATE TABLE event_photo (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  caption TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_event_photo_event ON event_photo(event_id, created_at);

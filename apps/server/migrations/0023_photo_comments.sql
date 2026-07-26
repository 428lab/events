-- イベント写真へのコメント（参加者が複数コメント可能）
CREATE TABLE event_photo_comment (
  id TEXT PRIMARY KEY,
  photo_id TEXT NOT NULL REFERENCES event_photo(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_photo_comment_photo ON event_photo_comment(photo_id, created_at);

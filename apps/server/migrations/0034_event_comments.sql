-- イベントコメント (#72)。参加確定者が投稿、削除は本人＋staff
CREATE TABLE event_comment (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_event_comment_event ON event_comment(event_id, created_at);

-- 参加者限定の文章 (#72)。確定メンバー＋staffにのみAPIで返す
ALTER TABLE event ADD COLUMN members_note TEXT NOT NULL DEFAULT '';

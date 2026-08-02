-- イベントのタイムテーブル (#116)。構造化した進行表（staff が編集、閲覧はイベントが見える人）
CREATE TABLE event_schedule_item (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  duration_min INTEGER NOT NULL DEFAULT 0,
  -- 明示的な開始時刻（epoch ms）。NULL なら前の項目から連鎖して自動計算
  starts_at INTEGER,
  -- 担当者（イベントメンバーへのリンク）。ユーザー削除時はフリーテキストだけ残す
  speaker_user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
  speaker_name TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_schedule_event ON event_schedule_item(event_id, sort_order);

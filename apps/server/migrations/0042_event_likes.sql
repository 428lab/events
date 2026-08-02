-- 参加者によるワンタップのいいね (#155)。誰が押したかは公開しない（集計のみ）
CREATE TABLE event_like (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,              -- 'event' | 'host' | 'staff' | 'community'
  target_key TEXT NOT NULL DEFAULT '',  -- host/staff: 対象user_id, community: community_id, event: ''
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_event_like_unique ON event_like(event_id, user_id, kind, target_key);
CREATE INDEX idx_event_like_target ON event_like(kind, target_key);
CREATE INDEX idx_event_like_event ON event_like(event_id, kind);

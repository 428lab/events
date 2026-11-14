-- コミュニティとイベントごとの Discord / Slack 通知 (docs/webhooks.md)。オーナー決定 2026-11-13。
--
-- scope='community' は community_id、scope='event' は event_id を持つ（もう片方は NULL）。
-- url は Webhook のトークンそのもの。API では返さない（種類・ホスト・末尾4文字だけ返す）。
-- created_by は user を参照する: アカウント統合で勝ち側へ付け替え（accountMerge.ts）、
-- 退会の完全削除では SET NULL（Webhook はコミュニティ・イベントの持ち物として残す）。
CREATE TABLE webhook (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('community', 'event')),
  community_id TEXT REFERENCES community(id) ON DELETE CASCADE,
  event_id TEXT REFERENCES event(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('discord', 'slack')),
  url TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  notify_inquiry INTEGER NOT NULL DEFAULT 1,
  notify_join INTEGER NOT NULL DEFAULT 1,
  notify_cancel INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  fail_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  last_sent_at INTEGER,
  created_by TEXT REFERENCES user(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  CHECK ((scope = 'community' AND community_id IS NOT NULL AND event_id IS NULL)
      OR (scope = 'event' AND event_id IS NOT NULL AND community_id IS NULL))
);
CREATE INDEX idx_webhook_community ON webhook(community_id) WHERE community_id IS NOT NULL;
CREATE INDEX idx_webhook_event ON webhook(event_id) WHERE event_id IS NOT NULL;

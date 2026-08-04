-- 運営向け監査ログ (#248)。アカウント統合・退会・連携の引き取りなど
-- 不可逆な重要操作を後から調査できるように記録する。
-- user への FK は張らない（退会・統合でユーザー行が消えても記録を残すため）。
-- detail にはメール・連絡先・チャット本文などの個人情報を入れないこと。
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,            -- account_merge / account_delete / identity_takeover / chat_channel_reset / admin_setting_change
  actor_user_id TEXT,              -- 実行者（退会等で消えるためFKは張らない）
  actor_handle TEXT NOT NULL DEFAULT '',   -- 実行時点のハンドル（後から辿れるように）
  target_user_id TEXT,
  target_handle TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '', -- JSON文字列（個人情報は入れない）
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_audit_log_created ON audit_log(created_at DESC);
CREATE INDEX idx_audit_log_action ON audit_log(action, created_at DESC);

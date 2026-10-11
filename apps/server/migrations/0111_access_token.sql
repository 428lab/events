-- #581 AI アシスタント等が本人として API を叩くための長命トークン（docs/ai-integration.md §4.1）。
-- 平文は発行時に1回だけ返し、DB にはハッシュだけを持つ。
CREATE TABLE access_token (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                 -- 利用者が付ける名前（"Claude Code" など。1〜40字）
  token_hash TEXT NOT NULL UNIQUE,    -- SHA-256(hex) of 平文トークン全体
  token_prefix TEXT NOT NULL,         -- 表示用の先頭 12 文字（"evl_ab12cd34"）
  scopes TEXT NOT NULL,               -- 'read' または 'read write'（空白区切り）
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,        -- 無期限は作らない（§4.3）
  last_used_at INTEGER,               -- 5分に1回だけ更新（§4.6）
  revoked_at INTEGER                  -- 失効。行は残す（一覧の「失効済み」表示用）
);
CREATE INDEX idx_access_token_user ON access_token(user_id);

-- #581 イベントの作成経路。'web'（画面）か 'ai'（/api/ai/v1 の create_event）。
-- AI 作成の下書きがどれだけ公開まで行ったかを数え、create_event の頻度制限にも使う（§4.6）
ALTER TABLE event ADD COLUMN created_via TEXT NOT NULL DEFAULT 'web';

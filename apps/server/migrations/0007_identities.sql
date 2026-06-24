-- 複数 OAuth プロバイダを1ユーザーに紐づけるための identity テーブル。
CREATE TABLE identity (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,            -- 'discord' | 'google' | 'github'
  provider_user_id TEXT NOT NULL,    -- プロバイダ側のユーザーID
  email TEXT,                        -- 検証済みメール（自動紐づけ用、無い場合あり）
  created_at INTEGER NOT NULL,
  UNIQUE(provider, provider_user_id)
);
CREATE INDEX idx_identity_user ON identity(user_id);
CREATE INDEX idx_identity_email ON identity(email);

-- 既存ユーザー（Discord）を identity へ移行。
INSERT INTO identity (id, user_id, provider, provider_user_id, email, created_at)
SELECT lower(hex(randomblob(16))), id, 'discord', discord_id, NULL, created_at
FROM user
WHERE discord_id IS NOT NULL AND discord_id <> '';

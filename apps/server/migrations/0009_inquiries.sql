-- サービス内お問い合わせ（スレッド形式）。運営が閲覧・返信、ユーザーは通知で確認。
CREATE TABLE inquiry (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  subject TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',     -- open | answered | closed
  created_at INTEGER NOT NULL,
  last_message_at INTEGER NOT NULL,
  last_sender TEXT NOT NULL DEFAULT 'user', -- 'user' | 'admin'
  user_read_at INTEGER NOT NULL DEFAULT 0,  -- ユーザーが最後に読んだ時刻
  admin_read_at INTEGER NOT NULL DEFAULT 0  -- 運営が最後に読んだ時刻
);
CREATE INDEX idx_inquiry_user ON inquiry(user_id);
CREATE INDEX idx_inquiry_status ON inquiry(status);

CREATE TABLE inquiry_message (
  id TEXT PRIMARY KEY,
  inquiry_id TEXT NOT NULL REFERENCES inquiry(id) ON DELETE CASCADE,
  sender TEXT NOT NULL,                      -- 'user' | 'admin'
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_inquiry_message_inquiry ON inquiry_message(inquiry_id);

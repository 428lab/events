-- 会場マッチング (#53 PR1): 会場登録
CREATE TABLE venue (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES user(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',       -- Markdown可
  area TEXT NOT NULL DEFAULT '',              -- 公開エリア（例: 東京都渋谷区）
  address TEXT NOT NULL DEFAULT '',           -- 詳細住所（address_public=0 ならマッチング後のみ開示）
  address_public INTEGER NOT NULL DEFAULT 0,
  capacity INTEGER,                           -- 収容人数（任意）
  equipment TEXT NOT NULL DEFAULT '',         -- 設備（Wi-Fi・プロジェクター等の自由記入）
  terms TEXT NOT NULL DEFAULT '',             -- 提供条件（自由記入。料金機能は未実装＝無料前提）
  contact TEXT NOT NULL DEFAULT '',           -- 連絡先（マッチング成立相手にのみ開示）
  image_updated_at INTEGER,                   -- カバー写真（R2）
  status TEXT NOT NULL DEFAULT 'open',        -- open=提供受付中 / closed=停止
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_venue_owner ON venue(owner_id);
CREATE INDEX idx_venue_status ON venue(status, created_at);

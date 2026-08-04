-- アプリ全体の運用設定 (key-value)。まずはチャットリレーのURL一覧に使用
CREATE TABLE app_setting (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

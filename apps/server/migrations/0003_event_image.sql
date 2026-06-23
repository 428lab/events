-- 画像本体は R2 に保存し、D1 にはメタ情報（mime, updated_at）のみ持つ。
CREATE TABLE event_image (
  event_id TEXT PRIMARY KEY REFERENCES event(id) ON DELETE CASCADE,
  mime TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

ALTER TABLE event ADD COLUMN image_updated_at INTEGER;

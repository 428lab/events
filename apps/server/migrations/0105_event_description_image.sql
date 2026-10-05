-- イベント説明文・参加者限定文章に差し込む画像 (D-DESC-IMAGE)。
-- 本体は R2 の event-description-images/<event_id>/<id>。id は推測不能な UUID で、
-- 配信 URL を知っていれば取得できる（説明文を読める人に URL が渡る前提）。
-- 1イベント10枚まで（上限はアップロード時に1文の条件付き INSERT で守る）
CREATE TABLE event_description_image (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_event_description_image_event ON event_description_image(event_id, created_at);

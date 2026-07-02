-- イベントの短いシェア用スラッグ（/e/:slug）。既存行は乱数hexで補填
ALTER TABLE event ADD COLUMN slug TEXT;
UPDATE event SET slug = lower(hex(randomblob(4))) WHERE slug IS NULL;
CREATE UNIQUE INDEX idx_event_slug ON event(slug);

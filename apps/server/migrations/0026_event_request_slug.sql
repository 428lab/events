-- たまごの短い共有URL用スラッグ (#42)。イベントの event.slug と同じ8文字hex
ALTER TABLE event_request ADD COLUMN slug TEXT;
-- 既存行のバックフィル（8文字hex。件数が少ない前提で衝突は無視できる確率）
UPDATE event_request SET slug = lower(hex(randomblob(4))) WHERE slug IS NULL;
CREATE UNIQUE INDEX idx_event_request_slug ON event_request(slug);

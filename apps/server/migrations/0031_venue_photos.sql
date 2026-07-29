-- 会場のギャラリー写真 (#63)。最大10点・オーナーのみ投稿
CREATE TABLE venue_photo (
  id TEXT PRIMARY KEY,
  venue_id TEXT NOT NULL REFERENCES venue(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_venue_photo_venue ON venue_photo(venue_id, created_at);

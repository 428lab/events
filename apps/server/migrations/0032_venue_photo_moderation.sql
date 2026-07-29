-- 会場写真の参加者投稿＋承認フロー (#65)
-- user_id: 投稿者（NULL=オーナー投稿の既存行）。status: approved(公開)/pending(審査待ち)
ALTER TABLE venue_photo ADD COLUMN user_id TEXT REFERENCES user(id);
ALTER TABLE venue_photo ADD COLUMN status TEXT NOT NULL DEFAULT 'approved';
CREATE INDEX idx_venue_photo_status ON venue_photo(venue_id, status);

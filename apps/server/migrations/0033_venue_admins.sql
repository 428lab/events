-- 会場の複数管理者 (#67)。オーナー(venue.owner_id)とは別の追加管理者
CREATE TABLE venue_admin (
  venue_id TEXT NOT NULL REFERENCES venue(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (venue_id, user_id)
);
CREATE INDEX idx_venue_admin_user ON venue_admin(user_id);

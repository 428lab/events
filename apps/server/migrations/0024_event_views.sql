-- イベントのアクセス統計（プライバシー配慮: 生IPは保存せず日次集計のみ）
CREATE TABLE event_view_stat (
  event_id TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  day TEXT NOT NULL,        -- 'YYYY-MM-DD'（JST）
  source TEXT NOT NULL,     -- 流入元ホスト / 'direct' / 'internal'
  country TEXT NOT NULL,    -- ISO2 or 'XX'
  views INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (event_id, day, source, country)
);
CREATE INDEX idx_view_stat_event ON event_view_stat(event_id, day);

-- ユニークビジター（visitor cookie で日次重複排除。生IPではない）
CREATE TABLE event_view_unique (
  event_id TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  PRIMARY KEY (event_id, day, visitor_id)
);

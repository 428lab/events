-- 出会いの景品引き換えモード (#431)。オンでイベントページに景品を表示
ALTER TABLE event ADD COLUMN meet_prizes INTEGER NOT NULL DEFAULT 0;

-- 景品の定義（イベントごとに主催者が作る）
CREATE TABLE event_prize (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  condition_type TEXT NOT NULL,   -- 'meet_count' | 'top_rank'
  threshold INTEGER,              -- meet_count のとき必要人数（1以上）。top_rank は NULL
  stock INTEGER NOT NULL,         -- 在庫総数（0以上。残数は引き換え行から導出）
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_event_prize_event ON event_prize(event_id);

-- 引き換えの記録（= 交換済みチェック。1景品につき1人1回）
CREATE TABLE event_prize_redemption (
  id TEXT PRIMARY KEY,
  prize_id TEXT NOT NULL REFERENCES event_prize(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  redeemed_by TEXT REFERENCES user(id) ON DELETE SET NULL,  -- 付けた staff（記録用）
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_event_prize_redemption_user
  ON event_prize_redemption(prize_id, user_id);

-- ランキング1位の確定（締めた時点のスナップショット。同率なら複数行）
CREATE TABLE event_meet_winner (
  event_id TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  count INTEGER NOT NULL,     -- 締めた時点の件数（表示用）
  decided_at INTEGER NOT NULL,
  PRIMARY KEY (event_id, user_id)
);

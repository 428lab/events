-- ビンゴ成績のスナップショット (#441)。end の瞬間に1ラウンドぶんを追記し、以後不変。
-- ラウンドの同一性は started_at（start で固定され、その回の間は不変）。
-- reset / ゲーム削除では消さない（終了した回の成績は残る）。イベント削除では消える
CREATE TABLE event_bingo_result (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL,    -- ラウンド識別（同一イベントの複数回戦を区別）
  ended_at INTEGER NOT NULL,
  rank INTEGER,                   -- ビンゴ順位（競技順位）。未達成は NULL
  completed_at_seq INTEGER,       -- ビンゴまでの抽選回数。未達成は NULL
  drawn_total INTEGER NOT NULL    -- その回で引かれた総数（「12回中7回目」の文脈用）
);
CREATE UNIQUE INDEX idx_event_bingo_result_round
  ON event_bingo_result(event_id, started_at, user_id);
CREATE INDEX idx_event_bingo_result_user ON event_bingo_result(user_id);

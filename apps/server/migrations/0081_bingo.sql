-- 数字ビンゴ (#436)。イベントにつき同時に1ゲーム。設計は docs/bingo.md
CREATE TABLE event_bingo_game (
  event_id TEXT PRIMARY KEY REFERENCES event(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'setup',   -- 'setup'（受付中）| 'running' | 'ended'
  -- 抽選順の全列（1..75 の順列 JSON）。開始時にサーバーが生成し、以後不変。
  -- 「引く」= drawn_count を1増やして先頭 drawn_count 個を公開済みにする
  draw_order TEXT,
  drawn_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  ended_at INTEGER
);

-- 参加者のカード（1人1枚・サーバー生成。列ごとの標準範囲 B1-15..O61-75）
CREATE TABLE event_bingo_card (
  event_id TEXT NOT NULL REFERENCES event_bingo_game(event_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  numbers TEXT NOT NULL,   -- JSON: 24個（5x5・中央FREE除く・列優先）
  created_at INTEGER NOT NULL,
  PRIMARY KEY (event_id, user_id)
);

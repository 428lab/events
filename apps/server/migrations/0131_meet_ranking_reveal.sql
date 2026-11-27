-- 出会いランキングの目隠しモード（オーナー依頼 2026-11-27「名前の目隠しモードが欲しい」
-- 「運営だけひとりずつ指定した名前を開くことができるようにして欲しい」「１回開くとみんなにも見える」）。
-- 運営が明かした人の集まり。ここに入っている人だけ、名前とアイコンを全員（投影・参加者のスマホ）に返す。
-- 順位ではなく人で持つ：明かしたあとに順位が動いても、その人は明かされたまま。
-- 「目隠しに戻す」で、そのイベントの行を全部消す。
CREATE TABLE event_meet_reveal (
  event_id TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  revealed_at INTEGER NOT NULL,
  PRIMARY KEY (event_id, user_id)
);

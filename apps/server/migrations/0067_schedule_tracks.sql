-- スケジュールのマルチトラック対応 (#338)。
--
-- 同時刻に複数の枠で並行してセッションが走るイベントに対応する。
-- セッションとトラックは多対多で、セッションは次の3つの状態を取る。
--
--   1. 未割り当て       ネタ出し中。まだどのトラックにも置いていない
--   2. 全トラック共通   開会・基調講演・休憩など。全列をまたぐ
--   3. 特定のトラック   1つ以上。複数にまたがることもある
--
-- **1 と 2 はどちらも対応表が空になる**ので、対応表の有無では区別できない。
-- 状態を明示する列 (placement) を持たせて区別する。

-- トラックの定義。イベント内の名前（ラベル）でしかなく、**会場の部屋とは紐づけない**
-- （部屋との紐付けは今回の対象外 #338）。
CREATE TABLE event_track (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- 表示順。タイムテーブルの列の並び
  sort_order INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_event_track_event ON event_track(event_id, sort_order);

-- セッションとトラックの対応表。
-- **参照する item_id はイベント保存をまたいで変わらない** (#340 で保存が差分化され、
-- クライアントが既存 ID を送り返す形になった)。全件削除→再作成のままだと、
-- 保存のたびにここの行が全部迷子になっていた。
CREATE TABLE event_schedule_item_track (
  item_id TEXT NOT NULL REFERENCES event_schedule_item(id) ON DELETE CASCADE,
  track_id TEXT NOT NULL REFERENCES event_track(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, track_id)
);
-- トラックを消したときに「そのトラックに載っていたセッション」を引くための索引
CREATE INDEX idx_schedule_item_track_track ON event_schedule_item_track(track_id);

-- 配置状態。'unassigned' = 未割り当て / 'all' = 全トラック共通 / 'tracks' = 特定のトラック。
--
-- **既定値は 'all'（全トラック共通）**。これで既存のセッションは列を足すだけで
-- 移行が済み、いまの見え方が変わらない。'unassigned' を既定にすると、
-- 公開済みイベントのタイムテーブルが参加者から丸ごと消える。
--
-- 'tracks' なのに対応表が空、という状態は作らない（サーバー側で 'unassigned' に落とす）。
-- トラックを削除して載る先が無くなったセッションが未割り当てに戻るのも同じ規則。
ALTER TABLE event_schedule_item ADD COLUMN placement TEXT NOT NULL DEFAULT 'all'
  CHECK (placement IN ('unassigned', 'all', 'tracks'));
-- 参加者に見せる側（一覧・リマインダーメール・資料ギャラリー）は placement で絞るので、
-- イベント単位の取得でそのまま効く索引を張る
CREATE INDEX idx_schedule_placement ON event_schedule_item(event_id, placement);

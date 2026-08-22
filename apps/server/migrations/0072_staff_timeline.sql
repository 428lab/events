-- スタッフ用タイムライン (#383)。
--
-- 準備・設営・片付けのような、参加者に見せない段取りをタイムテーブルに置けるようにする。
-- 表のセッションと**同じ時間軸**に並べるのが目的なので、別のタイムテーブルは作らず、
-- 既存の event_schedule_item / event_track にそれぞれ1列だけ足す。
--
-- 軸は2本あり、**混ぜない**。
--
--   placement   … どの列に置くか（未割り当て / 全トラック共通 / 特定のトラック）
--   visibility  … 誰に見せるか（参加者にも見せる / スタッフだけ）
--
-- placement に 'staff' を足す案は採らなかった。既存の絞り込みが
-- `placement != 'unassigned'` と書いてあるため、新しい値が**黙って通り抜ける**。
-- しかも placement を 'staff' にすると trackIds の意味が消え、
-- 「トラックAの裏方」が表現できなくなる（それが要件そのもの）。

-- スタッフ用トラック。表には無い列（控え室の留守番のように、
-- どのセッションにも紐づかない持ち場を置く先）。
--
-- **既定は 'public'**。既存のトラックは全部これまでどおり参加者に見える。
-- 表のトラックと同じ表で持つのは、時間軸を1本に保つため。別表にすると
-- 対応表・並び順・「トラックを消したら unassigned に落とす」規則が二重化する。
ALTER TABLE event_track ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'
  CHECK (visibility IN ('public', 'staff'));

-- 項目の見え方。'public' = 参加者にも見せる / 'staff' = スタッフだけ。
--
-- **既定は 'public'**。0067 で placement の既定を 'all' にしたのと同じ理由で、
-- 既存の項目は列を足すだけで移行が済み、いまの見え方が変わらない。
-- 既定を 'staff' にすると、公開済みイベントのタイムテーブルが参加者から丸ごと消える。
--
-- 絞り込みは必ず **`visibility = 'public'`（許可リスト）** で書くこと。
-- `!= 'staff'`（拒否リスト）で書くと、将来値が増えたときに新しい値が参加者へ漏れる。
-- placement の `!= 'unassigned'` が実際にその形で、案A を採れなかった理由でもある。
ALTER TABLE event_schedule_item ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'
  CHECK (visibility IN ('public', 'staff'));

-- 参加者向けの取得は placement と visibility を**両方**見る（イベント単位）。
-- 0067 の (event_id, placement) は同じ用途の索引なので張り替える。2本持つ意味がない。
DROP INDEX IF EXISTS idx_schedule_placement;
CREATE INDEX idx_schedule_visible
  ON event_schedule_item(event_id, visibility, placement);

-- 採点は運営が「採点を開始する」まで受け付けない（オーナー決定 2026-11-08）。
-- コンテストでプレゼンの前から採点できてしまうのを止める。
--
-- scoring_started: 0 = 未開始、1 = 開始済み。締切（scoring_locked）とは別の列。
--   未開始 → 開始（受付中）→ 締切 → 再開 … と進み、運営が「採点結果をすべて消す」と
--   点数を消して未開始・締切なしに戻る（チームの入れ替えもまたできる）。
-- 既存のイベントは、すでに点が入っているか締め切っているものだけ「開始済み」にする。
-- 進行中のイベントで、いきなり採点できなくなることはない。
ALTER TABLE event_state ADD COLUMN scoring_started INTEGER NOT NULL DEFAULT 0;

UPDATE event_state SET scoring_started = 1
 WHERE scoring_locked = 1
    OR EXISTS (SELECT 1 FROM score s WHERE s.event_id = event_state.event_id);

-- 点が入っているのに event_state の行がまだ無いイベント（行は初めて読むときに作る）も開始済みにする
INSERT INTO event_state (event_id, mode, scoring_locked, scoring_started, updated_at)
SELECT DISTINCT s.event_id, 'normal', 0, 1, CAST(strftime('%s', 'now') AS INTEGER) * 1000
  FROM score s
 WHERE NOT EXISTS (SELECT 1 FROM event_state st WHERE st.event_id = s.event_id);

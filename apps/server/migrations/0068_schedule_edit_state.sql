-- タイムテーブルの同時編集対策 (#340)。
--
-- 2人の運営が同時に編集すると、後から保存したほうが相手の変更を丸ごと消していた。
-- ここでは2段構えにする。
--
--   1. 助言  … 誰が編集中かをイベントごとに1行で持ち、他の人に見せる
--   2. 防衛  … 保存のたびに版 (version) を1つ進め、食い違ったら保存を止める
--
-- どちらも同じ1行に入れる。**編集中の解除で行を消さない**（版が消えるため）。
-- 編集者の列を NULL に戻すだけにする。
--
-- 配信の操作状態 (event_live_state) と同じ「イベントごとに1行を持ち、
-- 短い間隔で取りに行く」形。このアプリは常時接続を使わないため。
CREATE TABLE event_schedule_state (
  event_id TEXT PRIMARY KEY REFERENCES event(id) ON DELETE CASCADE,

  -- タイムテーブルの版。保存 (PUT) と資料URLの自己編集 (PATCH) で 1 つ進む。
  -- クライアントは読んだときの版を保存時に送り返し、食い違えば保存が止まる。
  -- OG サムネイルの取得のようなユーザーの編集でない書き込みでは進めない。
  version INTEGER NOT NULL DEFAULT 0,

  -- いま編集中の人。誰も編集していなければ NULL。
  -- **厳密な排他ではない**（助言）。保存できるかどうかは version だけが決める。
  editor_user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
  -- 編集を始めた時刻（表示用）
  editor_since INTEGER,
  -- 最後に「まだ編集中」と言ってきた時刻。ここから一定時間で自動的に解除される。
  -- 期限切れの判定は読むたびに時刻で行うので、掃除の仕組みは要らない
  editor_seen_at INTEGER,

  updated_at INTEGER NOT NULL
);

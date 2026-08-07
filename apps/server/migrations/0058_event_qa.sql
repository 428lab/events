-- イベントQ&A (#216)。参加者が質問を投稿し、投票で優先度が決まる。
--
-- チャット (#199) がリレー直結なのに対し、Q&A は票の集計・重複投票の防止・
-- モデレーションが要るのでサーバー（D1）で持つ。
--
-- 既定は OFF。チャット (#221) と同じく「使いたいイベントだけスタッフが ON にする」。
ALTER TABLE event ADD COLUMN qa_enabled INTEGER NOT NULL DEFAULT 0;
-- 匿名の扱い: 'real'=実名のみ / 'anon'=匿名のみ / 'choice'=投稿ごとに投稿者が選ぶ。
-- 既定は 'choice'（運営が範囲を決め、その中で参加者が選ぶ）。
ALTER TABLE event ADD COLUMN qa_anonymity TEXT NOT NULL DEFAULT 'choice';
-- 「いまこの質問」（#215 の投影画面で大きく出す1件）。NULL = ピックアップなし。
-- **1件だけ**という制約をテーブルではなくイベントの1列で表すことで、
-- 「2件ピックアップされている」状態が構造的に作れないようにする。
-- event_question(id) への FK は張らない（event → event_question → event の循環になり、
-- ALTER TABLE ADD COLUMN では後から張れないため）。参照先が消えた場合は
-- 一覧に出てこないので、読み出し側で「一覧に無いピックアップ」は無視する。
ALTER TABLE event ADD COLUMN qa_picked_question_id TEXT;

-- 質問。匿名投稿でも user_id は必ず記録する（荒らし対応のためスタッフには見える）。
-- anonymous は「一般参加者に投稿者を出さない」表示上のフラグでしかない。
CREATE TABLE event_question (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  anonymous INTEGER NOT NULL DEFAULT 0,
  -- スタッフが「回答済み」にした質問。一覧では未回答の下に送る
  answered INTEGER NOT NULL DEFAULT 0,
  -- スタッフの非表示（チャットの event_chat_hidden と同じ考え方）。
  -- 物理削除しないのは、誰が何を投稿したかの記録を残すため
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_event_question_event ON event_question(event_id, created_at);

-- 1質問1票（取り消し可）。主キーが (question_id, user_id) なので二重投票は入らない
CREATE TABLE event_question_vote (
  question_id TEXT NOT NULL REFERENCES event_question(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (question_id, user_id)
);
CREATE INDEX idx_event_question_vote_user ON event_question_vote(user_id);

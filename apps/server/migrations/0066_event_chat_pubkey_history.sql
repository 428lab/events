-- チャットで「その人がこれまでに使った発言鍵」を残す (#332)。
--
-- これまで発言鍵は event_chat_pubkey に「イベント×ユーザーで1行」しか持たず、
-- 登録し直すと前の鍵は消えていた。チャットの表示はこの許可リストで絞っているので、
-- 端末を変えて別の手段で参加し直すと、**前の鍵で書いた自分の発言が
-- （自分の画面からも他人の画面からも）まとめて消えて**しまう。
--
-- 過去の鍵もここに残し、表示許可リスト (listMembers) はこちらを見る。
-- event_chat_pubkey は「いま署名に使う鍵」を指すポインタとして残す
-- （一時鍵の secret の置き場でもある）。
CREATE TABLE event_chat_pubkey_history (
  event_id TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  pubkey TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  -- 鍵はイベント内で1人のもの。**履歴も含めて先着で押さえる**ことで、
  -- 誰かが手放した鍵を別の人が登録して、その鍵の過去の発言を自分の名前で
  -- 表示させることを防ぐ（登録時の pubkeyOwner もこの表を見る）
  PRIMARY KEY (event_id, pubkey)
);
-- 表示許可リストはこの表を user_id で引く
CREATE INDEX idx_event_chat_pubkey_history_user
  ON event_chat_pubkey_history (event_id, user_id);
-- 登録済みの鍵を履歴へ移す（これ以降、許可リストはこの表が元になる）
INSERT OR IGNORE INTO event_chat_pubkey_history (event_id, user_id, pubkey, created_at)
  SELECT event_id, user_id, pubkey, created_at FROM event_chat_pubkey;

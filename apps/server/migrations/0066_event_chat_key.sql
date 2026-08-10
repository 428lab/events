-- 発言鍵を「いま使っている1つ」から「その人がこのイベントで使った鍵ぜんぶ」へ (#332)。
--
-- これまで発言鍵は event_chat_pubkey に「イベント×ユーザーで1行」しか無く、
-- 登録し直すと前の鍵が消えていた。チャットの表示はこの許可リストで絞っているので、
-- 端末を変えて別の手段で参加し直すと、**前の鍵で書いた自分の発言が
-- （自分の画面からも他人の画面からも）まとめて消えて**しまっていた。
--
-- 表は増やさずに 1 本のまま作り直す。「いま署名に使う鍵」はサーバーが持つ必要が
-- 無い（本人の鍵が使える端末なら本人の鍵、使えない端末なら一時鍵、とブラウザ側で
-- 決まる）ので、残すのは **使った鍵の集合** と **サーバーが保管している一時鍵の秘密**
-- だけでよい。2 表に分けると「この鍵は誰のものか」を引く先が 2 か所になり、
-- 片方だけ見た問い合わせがなりすましの穴になる。
CREATE TABLE event_chat_key (
  event_id TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  pubkey TEXT NOT NULL,
  -- サーバー管理の一時鍵 (#223) の秘密鍵。本人の鍵で登録した行は NULL
  secret TEXT,
  created_at INTEGER NOT NULL,
  -- 鍵はイベント内で1人のもの。**過去に使った鍵も含めて先着で押さえる**ことで、
  -- 誰かが使わなくなった鍵を別の人が登録して、その鍵の過去の発言を
  -- 自分の名前で表示させることを防ぐ
  PRIMARY KEY (event_id, pubkey)
);
-- 表示許可リストはこの表を user_id で引く
CREATE INDEX idx_event_chat_key_user ON event_chat_key (event_id, user_id);
-- **一時鍵はイベント×ユーザーで1つだけ** (#332)。チャットに入るたびに発行すると、
-- 本人の鍵が使える端末と使えない端末を行き来するだけで鍵（＝許可リストの行）が
-- 際限なく増える。本人の鍵を登録してもこの行は消さないので、一時鍵は最初に
-- 発行した1つがずっと使い回される
CREATE UNIQUE INDEX idx_event_chat_key_ephemeral
  ON event_chat_key (event_id, user_id) WHERE secret IS NOT NULL;
-- 既存の登録を移す。移行前は「イベント×ユーザーで1行」だったので PK も
-- 部分UNIQUEも衝突しない（同じイベントで同じ鍵を2人が持つことは登録時に
-- 弾いていた。万一残っていても先に登録したほうを残す）。
-- secret も一緒に移すので、いま一時鍵で参加している人はそのまま同じ鍵を使い続ける
INSERT OR IGNORE INTO event_chat_key (event_id, user_id, pubkey, secret, created_at)
  SELECT event_id, user_id, pubkey, secret, created_at
    FROM event_chat_pubkey ORDER BY created_at ASC;
-- **旧表 (event_chat_pubkey) はここでは消さない**。消すと、これを流した時点から
-- 新しいコードを配るまでの間、動いている旧コードが引く先を失って全チャット経路が
-- 落ちる。戻すこともできなくなる（データが無い）。
--
-- 削除はこのPRには入れず、**あとから別の番号で追加する** (#336)。
-- `wrangler d1 migrations apply` は未適用ぶんを全部流すので、削除を今ここに
-- 置いておくと「0066 だけ適用する」手段が無く、同じ実行で旧表まで消えて
-- 分けた意味が無くなる。新しいコードが本番で安定して動いているのを確認してから、
-- そのとき追加するマイグレーションで落とす

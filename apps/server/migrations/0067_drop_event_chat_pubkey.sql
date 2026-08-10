-- 旧・発言鍵の表を落とす (#332)。0066 で event_chat_key へ移し終えている。
--
-- 0066 と分けてあるのは、**流す時点が違う**から。0066 は新しいコードを配る前に
-- 流せる（旧表はそのまま残るので、動いている旧コードは壊れない）。これは
-- 新しいコードが動いていることを確認してから流す。1つにまとめると、
-- どちらを先にしても片方のコードが引く先を失う時間ができ、戻すこともできない。
--
-- 0066 を流してから新しいコードが配られるまでの間に旧コードが書いた行
-- （その間にチャットへ参加した人の鍵）を拾ってから落とす。拾わないと、
-- その人の鍵が許可リストから漏れて発言が表示されない
-- （その人が新しいコードで既に一時鍵を受け取っていたら、鍵の行は残しつつ
--   secret だけ落とす。「一時鍵はイベント×ユーザーで1つ」に当たって行ごと
--   落ちると、その鍵で書いた発言が表示されなくなるため）
INSERT OR IGNORE INTO event_chat_key (event_id, user_id, pubkey, secret, created_at)
  SELECT p.event_id, p.user_id, p.pubkey,
         CASE WHEN EXISTS (SELECT 1 FROM event_chat_key k
                            WHERE k.event_id = p.event_id AND k.user_id = p.user_id
                              AND k.secret IS NOT NULL)
              THEN NULL ELSE p.secret END,
         p.created_at
    FROM event_chat_pubkey p ORDER BY p.created_at ASC;
DROP TABLE event_chat_pubkey;

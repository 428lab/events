-- Bluesky ログイン (#381) の認可開始〜コールバック間の持ち越し。
--
-- AT Protocol の OAuth は DPoP が必須で、ログイン試行ごとに ES256 鍵を作る。
-- その秘密鍵と PKCE の verifier、どの認可サーバーへ行ったか (iss) を
-- コールバックまで保持する必要がある。既存の使い捨て nonce の仕組み
-- (nostr_challenge_used) は「使ったかどうか」しか持てないため流用できない。
--
-- cookie に入れない理由: DPoP の秘密鍵をブラウザに預けることになるため。
-- ブラウザとの紐付け (CSRF 対策) は別途 cookie で行う (routes/authBluesky.ts)。
--
-- data は JSON。DPoP 鍵は JWK にして入れる (Key オブジェクトはそのままでは保存できない)。
--
-- 秘密鍵が入るので、行はできるだけ早く消す。消す経路は4つ:
--   1. 使ったとき      ライブラリが検証の前に del を呼ぶ (リプレイ防止)
--   2. 認可開始が失敗   PAR は行を書いた後に走るので、失敗したら開始側で消す
--   3. コールバックで弾く  期限切れ・cookie の tag 不一致はその場で消す
--   4. 掃除            上のどれにも当たらない (コールバックに来ないまま
--                      放置された・処理が途中で落ちた) 行は残る。次の認可開始の
--                      ついでに TTL の2倍 (20分) より古いものを消すので、
--                      **最大 20 分は残りうる**。cron は増やさない。
CREATE TABLE bluesky_oauth_state (
  state TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
-- 掃除 (created_at < ?) が全表走査にならないように
CREATE INDEX idx_bluesky_oauth_state_created ON bluesky_oauth_state(created_at);

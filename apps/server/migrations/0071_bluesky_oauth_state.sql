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
-- 秘密鍵が入るので、行は使用時に必ず削除し、TTL を過ぎたものは掃除する。
CREATE TABLE bluesky_oauth_state (
  state TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
-- 掃除 (created_at < ?) が全表走査にならないように
CREATE INDEX idx_bluesky_oauth_state_created ON bluesky_oauth_state(created_at);

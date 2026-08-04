-- 一時鍵のサーバー管理 (#223)。複数端末・アカウント切替でも同じ発言者鍵を
-- 使えるよう、イベント用の一時鍵はサーバーが生成・保管して配布する。
-- NIP-07（ユーザー自身の鍵）で登録した行は secret が NULL のまま。
ALTER TABLE event_chat_pubkey ADD COLUMN secret TEXT;

-- Nostrイベントチャット (#199)。チャット本文はリレー側にあり、ここには紐付けだけを持つ
ALTER TABLE event ADD COLUMN chat_enabled INTEGER NOT NULL DEFAULT 1;
-- NIP-28 チャンネル（kind:40）のイベントID。最初にチャットを開いたメンバーが登録（先勝ち）
ALTER TABLE event ADD COLUMN chat_channel_id TEXT;
-- 発言に使う公開鍵（イベント×ユーザーごとに1つ。表示許可リストの元データ）
CREATE TABLE event_chat_pubkey (
  event_id TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  pubkey TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (event_id, user_id)
);
-- アプリ側の非表示リスト（staff のモデレーション。リレー上の物理削除は対象外）
CREATE TABLE event_chat_hidden (
  event_id TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  note_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (event_id, note_id)
);

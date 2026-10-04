-- 参加者チャットを参加者だけに限定する（暗号化）(#582)。設計は docs/participant-encrypted-chat.md。
--
-- 1. event に設定列を足す（1.1）
-- 2. グループチャットの3表の audience CHECK を ('staff','members') に広げる（6.1）

-- 参加者チャットの暗号化。一度オンにしたら戻せない（サーバーが 409 で守る）
ALTER TABLE event ADD COLUMN chat_encrypted INTEGER NOT NULL DEFAULT 0;
-- オンにした時刻（ms）。平文の過去ログを「この時刻まで」に絞る表示判定に使う
ALTER TABLE event ADD COLUMN chat_encrypted_at INTEGER;

-- SQLite は CHECK を変更できないので3表を作り直す。
-- **スタッフチャットの部屋・鍵・signer を1行も失わないこと**が条件:
-- 親（event_group_chat_room）を先に DROP すると、外部キーが有効な環境では暗黙の
-- DELETE が子（key / signer）へ CASCADE して鍵が消える。そこで
--   (1) 3表の中身を一時表へ写す
--   (2) **子から** DROP する（signer → key → room。子が先に消えているので CASCADE は空振り）
--   (3) 0075 と同じ定義（audience の CHECK だけ変更）で作り直す
--   (4) 一時表から戻す（room → key → signer。親が先にあるので FK を満たす）
-- の順に固定する。行の全件一致は test/participant-encrypted-chat-migration.test.ts が守る。

CREATE TABLE tmp_0101_group_chat_room AS
  SELECT event_id, audience, room_id, created_at FROM event_group_chat_room;
CREATE TABLE tmp_0101_group_chat_key AS
  SELECT event_id, audience, version, secret, created_at, reason FROM event_group_chat_key;
CREATE TABLE tmp_0101_group_chat_signer AS
  SELECT event_id, audience, user_id, pubkey, secret, created_at, revoked_at
    FROM event_group_chat_signer;

DROP TABLE event_group_chat_signer;
DROP TABLE event_group_chat_key;
DROP TABLE event_group_chat_room;

-- グループチャットの部屋。'staff' はスタッフチャット (#382)、'members' は
-- 参加確定メンバー向けの暗号化チャット (#582)
CREATE TABLE event_group_chat_room (
  event_id TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  audience TEXT NOT NULL CHECK (audience IN ('staff', 'members')),
  room_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (event_id, audience)
);

CREATE TABLE event_group_chat_key (
  event_id TEXT NOT NULL,
  audience TEXT NOT NULL,
  version INTEGER NOT NULL,
  secret TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('created', 'rotated')),
  PRIMARY KEY (event_id, audience, version),
  FOREIGN KEY (event_id, audience)
    REFERENCES event_group_chat_room(event_id, audience) ON DELETE CASCADE
);

CREATE TABLE event_group_chat_signer (
  event_id TEXT NOT NULL,
  audience TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  pubkey TEXT NOT NULL,
  secret TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  PRIMARY KEY (event_id, audience, user_id),
  FOREIGN KEY (event_id, audience)
    REFERENCES event_group_chat_room(event_id, audience) ON DELETE CASCADE
);
CREATE UNIQUE INDEX idx_event_group_chat_signer_pubkey
  ON event_group_chat_signer (event_id, audience, pubkey);
CREATE INDEX idx_event_group_chat_signer_user
  ON event_group_chat_signer (user_id);

INSERT INTO event_group_chat_room (event_id, audience, room_id, created_at)
  SELECT event_id, audience, room_id, created_at FROM tmp_0101_group_chat_room;
INSERT INTO event_group_chat_key (event_id, audience, version, secret, created_at, reason)
  SELECT event_id, audience, version, secret, created_at, reason FROM tmp_0101_group_chat_key;
INSERT INTO event_group_chat_signer
    (event_id, audience, user_id, pubkey, secret, created_at, revoked_at)
  SELECT event_id, audience, user_id, pubkey, secret, created_at, revoked_at
    FROM tmp_0101_group_chat_signer;

DROP TABLE tmp_0101_group_chat_signer;
DROP TABLE tmp_0101_group_chat_key;
DROP TABLE tmp_0101_group_chat_room;

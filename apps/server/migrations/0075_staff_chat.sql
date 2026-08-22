-- イベントスタッフ用のチャットルーム (#382)。設計は docs/staff-chat.md。
--
-- audience 列（部屋の対象範囲）を最初から持つ。いまは 'staff' のみで、
-- #205（参加者向け非公開チャット）は CHECK に 'members' を足して同じ表に乗る。
--
-- **この3つの表は参加者に1行も返さない。** 読み書きする SQL は
-- db/repositories/staffChat.ts の中にしか置かないこと。この不変条件は
-- test/staff-chat-sql-audit.test.ts が機械で守る（#384 の監査と同じ仕掛け）。
-- event 表には列を足さない（部屋の存在がイベント行に同居していると、
-- serializer の変更1つで参加者向けペイロードに漏れる径路ができる。設計 6）。

-- グループチャットの部屋。room_id はサーバー採番の乱数64hex。
-- リレー上の e タグとしてだけ使い、イベントとの対応はこの表の中にしか無い。
CREATE TABLE event_group_chat_room (
  event_id TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  audience TEXT NOT NULL CHECK (audience IN ('staff')),
  room_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (event_id, audience)
);

-- グループ共通鍵（NIP-44 の conversation key、乱数32バイトのhex）。
-- ローテーションで version が増える。行は消さない：過去 version を消すと
-- その世代で書かれた履歴が現メンバーにも読めなくなる。
CREATE TABLE event_group_chat_key (
  event_id TEXT NOT NULL,
  audience TEXT NOT NULL,
  version INTEGER NOT NULL,
  secret TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  -- 'created'（部屋の開設） / 'rotated'（資格喪失によるローテーション）。監査用
  reason TEXT NOT NULL CHECK (reason IN ('created', 'rotated')),
  PRIMARY KEY (event_id, audience, version),
  FOREIGN KEY (event_id, audience)
    REFERENCES event_group_chat_room(event_id, audience) ON DELETE CASCADE
);

-- メンバーごとの発言用一時鍵（サーバー生成・保管 #223 と同方式）。
-- 参加者チャットの event_chat_key とは分ける：あちらの行は chat-members API
-- （全参加者が取る表示許可リスト）に出るので、混ぜるとスタッフチャットの
-- pubkey が参加者に紐付いてしまう（設計 6.2）。
-- 行は消さない（消すとその人の過去の発言が全員の画面から消える）。
-- revoked_at: スタッフ資格を失った時刻。表示側は「revoked_at より後に
-- 作られたメッセージ」を描画しない（資格喪失後の書き込みを画面に出さない）。
--
-- user(id) を参照する列を足すので mergeUsers への登録が要る。PK に user_id を
-- 含むため simple ではなく uniqueKeyed に足すこと（test/merge-user-columns
-- .test.ts (#396) が登録漏れと数の不一致を落とす）。
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
-- 同じ部屋で同じ pubkey を2人が持てない（乱数衝突の保険。既存 0066 と同じ考え）
CREATE UNIQUE INDEX idx_event_group_chat_signer_pubkey
  ON event_group_chat_signer (event_id, audience, pubkey);
-- mergeUsers の付け替えと退会 purge の列挙で user 起点に引く向き
CREATE INDEX idx_event_group_chat_signer_user
  ON event_group_chat_signer (user_id);

-- チームのスライドの同時編集: デッキごとの同期の鍵 (docs/team-deck-live-sync.md §4.2)。
--
-- 今の世代の1行だけを持つ（古い世代は残さない）。secret は 32 バイト乱数の hex で、
-- タブどうしが送り合う差分を NIP-44 v2 で暗号化する鍵。配るのは編集用の GET だけで、
-- 作るのも読むのも編集できるかの判定（deckEditableSql）と同じ SQL の中で行う。
-- user を参照しないので、統合・退会の登録簿（userTables.ts）の対象外。
--
-- 編集できる人が減りうるときに作り直す（version+1、新しい乱数）。入っただけでは作り直さない。
-- entry_member の行が消える経路（抜ける・外す・別チームへ移る・0115 のトリガー経由の
-- 参加取消や状態・ロールの変更・ユーザー削除の CASCADE）は下のトリガー1つで拾う。
-- 行は残るが編集できなくなる経路（退会の申請・チーム参加のオフ・コンテスト形式のオフ・
-- 終わった招待限定イベントでの閲覧の取消）は、それぞれの batch に明示の UPDATE を置く。
CREATE TABLE deck_sync_key (
  deck_id TEXT PRIMARY KEY REFERENCES deck(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  secret TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TRIGGER deck_sync_key_rotate_on_member_delete AFTER DELETE ON entry_member
BEGIN
  UPDATE deck_sync_key SET version = version + 1, secret = lower(hex(randomblob(32)))
   WHERE deck_id IN (SELECT id FROM deck WHERE team_entry_id = OLD.entry_id);
END;

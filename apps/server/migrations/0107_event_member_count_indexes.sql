-- 参加者数を数えるサブクエリ用のインデックス（D-POLL-MIN 第3段階）。
--
-- 参加枠の人数（participationSlots.ts の SELECT_SLOT）は slot_id で数えるが、
-- slot_id のインデックスが無く、枠ごと・状態ごとに event_member 全体を読んでいた。
-- イベントの参加者数・出席者数・定員（events.ts の PARTICIPANT_COUNT_SQL ほか）は
-- event_id の索引からテーブル本体を引き、status・attended・slot_id を1行ずつ確かめていた。
-- どちらも数える列をインデックスに含め、テーブル本体を読まずに数えられるようにする。
-- user_id は退会者を除く EXISTS (COUNTED_MEMBER_IS_ACTIVE) の結合キー。
CREATE INDEX IF NOT EXISTS idx_event_member_slot_status ON event_member(slot_id, status);
CREATE INDEX IF NOT EXISTS idx_event_member_event_status ON event_member(event_id, status, attended, slot_id, user_id);

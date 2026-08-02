-- 参加取消の履歴を残す（参加実績・キャンセル集計用）。
-- 取消時は行を削除せず status='canceled' とし、取消日時を記録する。
ALTER TABLE event_member ADD COLUMN canceled_at INTEGER;
-- 取消時に日程調整中（開催日未確定）だった場合は集計対象外にするためのフラグ
ALTER TABLE event_member ADD COLUMN canceled_scheduling INTEGER NOT NULL DEFAULT 0;

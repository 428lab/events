-- 出席チェック。ON のイベントは「出席チェック済みの人だけ」を参加者として扱う
ALTER TABLE event ADD COLUMN attendance_check INTEGER NOT NULL DEFAULT 0;
-- 実際に参加した（スタッフがチェック）
ALTER TABLE event_member ADD COLUMN attended INTEGER NOT NULL DEFAULT 0;

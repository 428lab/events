-- 抽選枠の抽選日時（任意）。参加者への告知と当選操作の目安に使う。
ALTER TABLE participation_slot ADD COLUMN draw_at INTEGER;

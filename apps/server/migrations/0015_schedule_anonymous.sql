-- 日程調整の回答者を匿名にするか（0=名前を表示 / 1=匿名・人数のみ）
ALTER TABLE event ADD COLUMN schedule_anonymous INTEGER NOT NULL DEFAULT 0;

-- 前日リマインダーメールの送信済み記録 (#126)。cron が対象抽出時に NULL のみ選ぶ
ALTER TABLE event_member ADD COLUMN reminder_sent_at INTEGER;

-- 日程確定後も日程調整の結果（回答者一覧）を表示するか（主催者がオンオフ可能）
ALTER TABLE event ADD COLUMN schedule_visible INTEGER NOT NULL DEFAULT 1;

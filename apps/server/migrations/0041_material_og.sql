-- 資料URLのOGメタキャッシュ（サムネイル表示用）。og_url は取得時のURL（変更検知用）
ALTER TABLE event_schedule_item ADD COLUMN material_og_image TEXT NOT NULL DEFAULT '';
ALTER TABLE event_schedule_item ADD COLUMN material_og_url TEXT NOT NULL DEFAULT '';

-- タイムテーブルのコマに登壇資料URL（外部サービス・デッキ等）を持たせる
ALTER TABLE event_schedule_item ADD COLUMN material_url TEXT NOT NULL DEFAULT '';

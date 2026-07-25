-- イベント写真を参加者以外にも公開するか（主催者が切替。既定は参加者限定）
ALTER TABLE event ADD COLUMN photos_public INTEGER NOT NULL DEFAULT 0;

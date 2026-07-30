-- たまごの賛同者表示切替 (#87)。0=表示（既定）/ 1=匿名（人数のみ）
ALTER TABLE event_request ADD COLUMN reactors_anonymous INTEGER NOT NULL DEFAULT 0;

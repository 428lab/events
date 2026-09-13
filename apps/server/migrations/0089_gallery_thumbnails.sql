-- New uploads only; existing media retain their legacy image/poster URLs.
ALTER TABLE event_photo ADD COLUMN has_thumbnail INTEGER NOT NULL DEFAULT 0;

CREATE TABLE event_image (
  event_id TEXT PRIMARY KEY REFERENCES event(id) ON DELETE CASCADE,
  mime TEXT NOT NULL,
  data BLOB NOT NULL,
  updated_at INTEGER NOT NULL
);

ALTER TABLE event ADD COLUMN image_updated_at INTEGER;

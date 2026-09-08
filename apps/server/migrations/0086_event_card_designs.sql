-- Event-only print documents; individual profile cards remain untouched (#506).
CREATE TABLE event_card_design (
  event_id TEXT PRIMARY KEY REFERENCES event(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision > 0),
  document_json TEXT NOT NULL,
  write_token TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE event_card_asset (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  ready INTEGER NOT NULL DEFAULT 0 CHECK (ready IN (0, 1)),
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (id, event_id)
);
CREATE INDEX event_card_asset_event ON event_card_asset(event_id);
CREATE TABLE event_card_design_asset (
  event_id TEXT NOT NULL REFERENCES event_card_design(event_id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL,
  PRIMARY KEY (event_id, asset_id),
  FOREIGN KEY (asset_id, event_id) REFERENCES event_card_asset(id, event_id) ON DELETE CASCADE
);

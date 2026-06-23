CREATE TABLE participation_slot (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  capacity INTEGER NOT NULL,
  selection_type TEXT NOT NULL DEFAULT 'first_come',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_slot_event ON participation_slot(event_id);

ALTER TABLE event_member ADD COLUMN slot_id TEXT REFERENCES participation_slot(id) ON DELETE SET NULL;
ALTER TABLE event_member ADD COLUMN status TEXT NOT NULL DEFAULT 'confirmed';

-- Atomic finalization receipt and staff-only registration outcomes.
CREATE TABLE event_schedule_finalization (
  event_id TEXT PRIMARY KEY REFERENCES event(id) ON DELETE CASCADE,
  option_id TEXT NOT NULL,
  token TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE event_schedule_registration (
  event_id TEXT NOT NULL REFERENCES event_schedule_finalization(event_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  outcome TEXT NOT NULL,
  status TEXT,
  reason TEXT,
  slot_id TEXT,
  member_id TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  PRIMARY KEY (event_id, user_id)
);

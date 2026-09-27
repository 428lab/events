-- One current, transient action per event; no actor or receipt history.
ALTER TABLE event_live_state ADD COLUMN cutin_action_id TEXT;
ALTER TABLE event_live_state ADD COLUMN cutin_message TEXT;
ALTER TABLE event_live_state ADD COLUMN cutin_issued_at INTEGER;
ALTER TABLE event_live_state ADD COLUMN cutin_expires_at INTEGER;

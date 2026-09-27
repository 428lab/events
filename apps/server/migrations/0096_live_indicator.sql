-- Manual event-scoped declaration; existing events and newly initialized rows start OFF.
ALTER TABLE event_live_state ADD COLUMN live_indicator_on INTEGER NOT NULL DEFAULT 0 CHECK (live_indicator_on IN (0, 1));

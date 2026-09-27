-- A source must be explicitly enabled per event by confirmed staff; old rows stay OFF.
ALTER TABLE event_live_state ADD COLUMN chat_source TEXT NOT NULL DEFAULT 'off' CHECK (chat_source IN ('off', 'event'));

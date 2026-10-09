-- D-EVENT-CONTACT: inquiries addressed to one event's organizers.
--
-- inquiry.event_id NULL  = the existing inquiry to the app operators (admins).
-- inquiry.event_id set   = an inquiry to that event's confirmed staff. App admins never
--   see these (routes/inquiries.ts filters event_id IS NULL on every admin query).
-- For event inquiries, last_sender is 'staff' after a staff reply, and admin_read_at is
--   the organizer side's read time (shared by all confirmed staff of the event).
-- inquiry_message.sender gains 'staff' (TEXT, no schema change). author_id records which
--   user wrote the message, so a staff reply stays attributable; it is SET NULL when that
--   user is deleted and reassigned by account merge.
ALTER TABLE inquiry ADD COLUMN event_id TEXT REFERENCES event(id) ON DELETE CASCADE;
CREATE INDEX idx_inquiry_event ON inquiry(event_id, last_message_at);
ALTER TABLE inquiry_message ADD COLUMN author_id TEXT REFERENCES user(id) ON DELETE SET NULL;

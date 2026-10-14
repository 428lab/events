-- D-EVENT-SCHEDULED-PUBLISH: a draft event's scheduled publish time (epoch ms).
-- NULL = not scheduled. While set, status is always 'draft'; publishing (manual or
-- scheduled) clears it in the same UPDATE (docs/event-scheduled-publish.md §3.2).
-- The partial index keeps the per-minute due check to the scheduled rows only.
ALTER TABLE event ADD COLUMN publish_at INTEGER;
CREATE INDEX idx_event_publish_at ON event(publish_at) WHERE publish_at IS NOT NULL;

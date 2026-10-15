-- #625: co-host communities of an event (docs/event-cohost.md).
--
-- event.community_id stays the single host. A co-host is shown on the event page and
-- listed on the co-host community's page, nothing more: it grants no management or
-- viewing rights (eventManagerSql / eventViewSql never read this table) and is not
-- counted in KPI, trending, event_count, member_count or affiliations.
--
-- status: 'pending' until an owner/admin of the co-host community accepts it.
-- Declining or withdrawing deletes the row, so there is no 'declined' state.
--
-- No column references user. The result notice goes to event.created_by, so who sent
-- the request is not stored; this keeps the table out of account merge/deletion
-- (userTables / accountMerge column audits).
CREATE TABLE event_cohost (
  event_id TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  community_id TEXT NOT NULL REFERENCES community(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted')),
  created_at INTEGER NOT NULL,
  responded_at INTEGER,
  PRIMARY KEY (event_id, community_id)
);
CREATE INDEX idx_event_cohost_community ON event_cohost(community_id, status);

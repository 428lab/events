CREATE TABLE community (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon_url TEXT,
  owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_community_owner ON community(owner_id);

CREATE TABLE community_member (
  id TEXT PRIMARY KEY,
  community_id TEXT NOT NULL REFERENCES community(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  created_at INTEGER NOT NULL,
  UNIQUE (community_id, user_id)
);
CREATE INDEX idx_community_member_user ON community_member(user_id);
CREATE INDEX idx_community_member_community ON community_member(community_id);

-- イベントはコミュニティに任意で所属（無所属も可）。FKはアプリ側で担保
ALTER TABLE event ADD COLUMN community_id TEXT;
CREATE INDEX idx_event_community ON event(community_id);

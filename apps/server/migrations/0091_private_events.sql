-- #526. 0090 is reserved for the independent deck import migration.
-- Additive schema only; nonpublic creation remains closed until the access matrix is complete.
ALTER TABLE event ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'
  CHECK (visibility IN ('public','unlisted','private'));
ALTER TABLE event ADD COLUMN access_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE event ADD COLUMN access_operation_token TEXT; -- batch内の条件付き副作用用、API非公開
CREATE INDEX idx_event_visibility_status_start
  ON event(visibility, status, starts_at, id);
CREATE INDEX idx_event_community_visibility_status
  ON event(community_id, visibility, status, starts_at);
CREATE TABLE event_access_invite (
  id TEXT PRIMARY KEY, -- random UUID、bearer credentialではない
  event_id TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  invited_by TEXT REFERENCES user(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','accepted','declined','revoked')),
  source TEXT NOT NULL CHECK(source IN ('invite','existing_member')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER, -- pendingのみ必須。epoch ms
  responded_at INTEGER,
  UNIQUE(event_id, user_id),
  CHECK(status <> 'pending' OR expires_at IS NOT NULL)
);
CREATE INDEX idx_event_access_invite_user_status
  ON event_access_invite(user_id, status, created_at);
ALTER TABLE notification ADD COLUMN event_id TEXT REFERENCES event(id) ON DELETE CASCADE;
CREATE INDEX idx_notification_event_user ON notification(event_id, user_id);
ALTER TABLE user ADD COLUMN card_image_generation TEXT NOT NULL DEFAULT '';
-- 旧PNGとの互換は配信ではなく一度の再生成。世代は128bit乱数32hex、再利用しない。
UPDATE user SET card_image_generation = lower(hex(randomblob(16))),
  card_image_updated_at = NULL;

-- Associate only exact existing event URLs, including child paths and queries.
UPDATE notification SET event_id = (
  SELECT e.id FROM event e
  WHERE notification.link = '/events/' || e.id
     OR substr(notification.link, 1, length(e.id) + 9) = '/events/' || e.id || '/'
     OR substr(notification.link, 1, length(e.id) + 9) = '/events/' || e.id || '?'
) WHERE event_id IS NULL;

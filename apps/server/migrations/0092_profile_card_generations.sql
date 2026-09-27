CREATE INDEX idx_schedule_speaker_user ON event_schedule_item(speaker_user_id,event_id);
CREATE INDEX idx_event_like_sender ON event_like(user_id,event_id);

-- Local contributor invalidation. BEFORE captures disappearing relations; AFTER captures arrivals.
-- No card-generation column is watched, so these updates cannot recursively invalidate cards.

CREATE TRIGGER card_event_member_before_delete BEFORE DELETE ON event_member

BEGIN
  UPDATE user SET card_image_generation=lower(hex(randomblob(16))), card_image_updated_at=NULL
  WHERE id IN (SELECT user_id FROM event_member WHERE event_id IN (SELECT OLD.event_id)
    UNION SELECT speaker_user_id FROM event_schedule_item WHERE event_id IN (SELECT OLD.event_id)
    UNION SELECT target_key FROM event_like WHERE event_id IN (SELECT OLD.event_id) AND kind IN ('host','staff','participant')
    UNION SELECT user_low FROM event_meet WHERE event_id IN (SELECT OLD.event_id)
    UNION SELECT user_high FROM event_meet WHERE event_id IN (SELECT OLD.event_id));
END;

CREATE TRIGGER card_event_member_before_update BEFORE UPDATE OF event_id,user_id,role,status,attended,slot_id ON event_member
WHEN OLD.event_id IS NOT NEW.event_id OR OLD.user_id IS NOT NEW.user_id OR OLD.role IS NOT NEW.role OR OLD.status IS NOT NEW.status OR OLD.attended IS NOT NEW.attended OR OLD.slot_id IS NOT NEW.slot_id
BEGIN
  UPDATE user SET card_image_generation=lower(hex(randomblob(16))), card_image_updated_at=NULL
  WHERE id IN (SELECT user_id FROM event_member WHERE event_id IN (SELECT OLD.event_id)
    UNION SELECT speaker_user_id FROM event_schedule_item WHERE event_id IN (SELECT OLD.event_id)
    UNION SELECT target_key FROM event_like WHERE event_id IN (SELECT OLD.event_id) AND kind IN ('host','staff','participant')
    UNION SELECT user_low FROM event_meet WHERE event_id IN (SELECT OLD.event_id)
    UNION SELECT user_high FROM event_meet WHERE event_id IN (SELECT OLD.event_id));
END;

CREATE TRIGGER card_event_member_after_insert AFTER INSERT ON event_member

BEGIN
  UPDATE user SET card_image_generation=lower(hex(randomblob(16))), card_image_updated_at=NULL
  WHERE id IN (SELECT user_id FROM event_member WHERE event_id IN (SELECT NEW.event_id)
    UNION SELECT speaker_user_id FROM event_schedule_item WHERE event_id IN (SELECT NEW.event_id)
    UNION SELECT target_key FROM event_like WHERE event_id IN (SELECT NEW.event_id) AND kind IN ('host','staff','participant')
    UNION SELECT user_low FROM event_meet WHERE event_id IN (SELECT NEW.event_id)
    UNION SELECT user_high FROM event_meet WHERE event_id IN (SELECT NEW.event_id));
END;

CREATE TRIGGER card_event_member_after_update AFTER UPDATE OF event_id,user_id,role,status,attended,slot_id ON event_member
WHEN OLD.event_id IS NOT NEW.event_id OR OLD.user_id IS NOT NEW.user_id OR OLD.role IS NOT NEW.role OR OLD.status IS NOT NEW.status OR OLD.attended IS NOT NEW.attended OR OLD.slot_id IS NOT NEW.slot_id
BEGIN
  UPDATE user SET card_image_generation=lower(hex(randomblob(16))), card_image_updated_at=NULL
  WHERE id IN (SELECT user_id FROM event_member WHERE event_id IN (SELECT NEW.event_id)
    UNION SELECT speaker_user_id FROM event_schedule_item WHERE event_id IN (SELECT NEW.event_id)
    UNION SELECT target_key FROM event_like WHERE event_id IN (SELECT NEW.event_id) AND kind IN ('host','staff','participant')
    UNION SELECT user_low FROM event_meet WHERE event_id IN (SELECT NEW.event_id)
    UNION SELECT user_high FROM event_meet WHERE event_id IN (SELECT NEW.event_id));
END;

CREATE TRIGGER card_event_schedule_item_before_delete BEFORE DELETE ON event_schedule_item

BEGIN
  UPDATE user SET card_image_generation=lower(hex(randomblob(16))), card_image_updated_at=NULL
  WHERE id IN (SELECT user_id FROM event_member WHERE event_id IN (SELECT OLD.event_id)
    UNION SELECT speaker_user_id FROM event_schedule_item WHERE event_id IN (SELECT OLD.event_id)
    UNION SELECT target_key FROM event_like WHERE event_id IN (SELECT OLD.event_id) AND kind IN ('host','staff','participant')
    UNION SELECT user_low FROM event_meet WHERE event_id IN (SELECT OLD.event_id)
    UNION SELECT user_high FROM event_meet WHERE event_id IN (SELECT OLD.event_id));
END;

CREATE TRIGGER card_event_schedule_item_before_update BEFORE UPDATE OF event_id,speaker_user_id,visibility,placement ON event_schedule_item
WHEN OLD.event_id IS NOT NEW.event_id OR OLD.speaker_user_id IS NOT NEW.speaker_user_id OR OLD.visibility IS NOT NEW.visibility OR OLD.placement IS NOT NEW.placement
BEGIN
  UPDATE user SET card_image_generation=lower(hex(randomblob(16))), card_image_updated_at=NULL
  WHERE id IN (SELECT user_id FROM event_member WHERE event_id IN (SELECT OLD.event_id)
    UNION SELECT speaker_user_id FROM event_schedule_item WHERE event_id IN (SELECT OLD.event_id)
    UNION SELECT target_key FROM event_like WHERE event_id IN (SELECT OLD.event_id) AND kind IN ('host','staff','participant')
    UNION SELECT user_low FROM event_meet WHERE event_id IN (SELECT OLD.event_id)
    UNION SELECT user_high FROM event_meet WHERE event_id IN (SELECT OLD.event_id));
END;

CREATE TRIGGER card_event_schedule_item_after_insert AFTER INSERT ON event_schedule_item

BEGIN
  UPDATE user SET card_image_generation=lower(hex(randomblob(16))), card_image_updated_at=NULL
  WHERE id IN (SELECT user_id FROM event_member WHERE event_id IN (SELECT NEW.event_id)
    UNION SELECT speaker_user_id FROM event_schedule_item WHERE event_id IN (SELECT NEW.event_id)
    UNION SELECT target_key FROM event_like WHERE event_id IN (SELECT NEW.event_id) AND kind IN ('host','staff','participant')
    UNION SELECT user_low FROM event_meet WHERE event_id IN (SELECT NEW.event_id)
    UNION SELECT user_high FROM event_meet WHERE event_id IN (SELECT NEW.event_id));
END;

CREATE TRIGGER card_event_schedule_item_after_update AFTER UPDATE OF event_id,speaker_user_id,visibility,placement ON event_schedule_item
WHEN OLD.event_id IS NOT NEW.event_id OR OLD.speaker_user_id IS NOT NEW.speaker_user_id OR OLD.visibility IS NOT NEW.visibility OR OLD.placement IS NOT NEW.placement
BEGIN
  UPDATE user SET card_image_generation=lower(hex(randomblob(16))), card_image_updated_at=NULL
  WHERE id IN (SELECT user_id FROM event_member WHERE event_id IN (SELECT NEW.event_id)
    UNION SELECT speaker_user_id FROM event_schedule_item WHERE event_id IN (SELECT NEW.event_id)
    UNION SELECT target_key FROM event_like WHERE event_id IN (SELECT NEW.event_id) AND kind IN ('host','staff','participant')
    UNION SELECT user_low FROM event_meet WHERE event_id IN (SELECT NEW.event_id)
    UNION SELECT user_high FROM event_meet WHERE event_id IN (SELECT NEW.event_id));
END;

CREATE TRIGGER card_event_like_before_delete BEFORE DELETE ON event_like
WHEN OLD.kind IN ('host','staff','participant')
BEGIN
  UPDATE user SET card_image_generation=lower(hex(randomblob(16))), card_image_updated_at=NULL
  WHERE id IN (SELECT user_id FROM event_member WHERE event_id IN (SELECT OLD.event_id)
    UNION SELECT speaker_user_id FROM event_schedule_item WHERE event_id IN (SELECT OLD.event_id)
    UNION SELECT target_key FROM event_like WHERE event_id IN (SELECT OLD.event_id) AND kind IN ('host','staff','participant')
    UNION SELECT user_low FROM event_meet WHERE event_id IN (SELECT OLD.event_id)
    UNION SELECT user_high FROM event_meet WHERE event_id IN (SELECT OLD.event_id));
END;

CREATE TRIGGER card_event_like_before_update BEFORE UPDATE OF event_id,user_id,kind,target_key ON event_like
WHEN (OLD.kind IN ('host','staff','participant')) AND (OLD.event_id IS NOT NEW.event_id OR OLD.user_id IS NOT NEW.user_id OR OLD.kind IS NOT NEW.kind OR OLD.target_key IS NOT NEW.target_key)
BEGIN
  UPDATE user SET card_image_generation=lower(hex(randomblob(16))), card_image_updated_at=NULL
  WHERE id IN (SELECT user_id FROM event_member WHERE event_id IN (SELECT OLD.event_id)
    UNION SELECT speaker_user_id FROM event_schedule_item WHERE event_id IN (SELECT OLD.event_id)
    UNION SELECT target_key FROM event_like WHERE event_id IN (SELECT OLD.event_id) AND kind IN ('host','staff','participant')
    UNION SELECT user_low FROM event_meet WHERE event_id IN (SELECT OLD.event_id)
    UNION SELECT user_high FROM event_meet WHERE event_id IN (SELECT OLD.event_id));
END;

CREATE TRIGGER card_event_like_after_insert AFTER INSERT ON event_like
WHEN NEW.kind IN ('host','staff','participant')
BEGIN
  UPDATE user SET card_image_generation=lower(hex(randomblob(16))), card_image_updated_at=NULL
  WHERE id IN (SELECT user_id FROM event_member WHERE event_id IN (SELECT NEW.event_id)
    UNION SELECT speaker_user_id FROM event_schedule_item WHERE event_id IN (SELECT NEW.event_id)
    UNION SELECT target_key FROM event_like WHERE event_id IN (SELECT NEW.event_id) AND kind IN ('host','staff','participant')
    UNION SELECT user_low FROM event_meet WHERE event_id IN (SELECT NEW.event_id)
    UNION SELECT user_high FROM event_meet WHERE event_id IN (SELECT NEW.event_id));
END;

CREATE TRIGGER card_event_like_after_update AFTER UPDATE OF event_id,user_id,kind,target_key ON event_like
WHEN (NEW.kind IN ('host','staff','participant')) AND (OLD.event_id IS NOT NEW.event_id OR OLD.user_id IS NOT NEW.user_id OR OLD.kind IS NOT NEW.kind OR OLD.target_key IS NOT NEW.target_key)
BEGIN
  UPDATE user SET card_image_generation=lower(hex(randomblob(16))), card_image_updated_at=NULL
  WHERE id IN (SELECT user_id FROM event_member WHERE event_id IN (SELECT NEW.event_id)
    UNION SELECT speaker_user_id FROM event_schedule_item WHERE event_id IN (SELECT NEW.event_id)
    UNION SELECT target_key FROM event_like WHERE event_id IN (SELECT NEW.event_id) AND kind IN ('host','staff','participant')
    UNION SELECT user_low FROM event_meet WHERE event_id IN (SELECT NEW.event_id)
    UNION SELECT user_high FROM event_meet WHERE event_id IN (SELECT NEW.event_id));
END;

CREATE TRIGGER card_event_meet_before_delete BEFORE DELETE ON event_meet

BEGIN
  UPDATE user SET card_image_generation=lower(hex(randomblob(16))), card_image_updated_at=NULL
  WHERE id IN (SELECT user_id FROM event_member WHERE event_id IN (SELECT OLD.event_id)
    UNION SELECT speaker_user_id FROM event_schedule_item WHERE event_id IN (SELECT OLD.event_id)
    UNION SELECT target_key FROM event_like WHERE event_id IN (SELECT OLD.event_id) AND kind IN ('host','staff','participant')
    UNION SELECT user_low FROM event_meet WHERE event_id IN (SELECT OLD.event_id)
    UNION SELECT user_high FROM event_meet WHERE event_id IN (SELECT OLD.event_id));
END;

CREATE TRIGGER card_event_meet_before_update BEFORE UPDATE OF event_id,user_low,user_high ON event_meet
WHEN OLD.event_id IS NOT NEW.event_id OR OLD.user_low IS NOT NEW.user_low OR OLD.user_high IS NOT NEW.user_high
BEGIN
  UPDATE user SET card_image_generation=lower(hex(randomblob(16))), card_image_updated_at=NULL
  WHERE id IN (SELECT user_id FROM event_member WHERE event_id IN (SELECT OLD.event_id)
    UNION SELECT speaker_user_id FROM event_schedule_item WHERE event_id IN (SELECT OLD.event_id)
    UNION SELECT target_key FROM event_like WHERE event_id IN (SELECT OLD.event_id) AND kind IN ('host','staff','participant')
    UNION SELECT user_low FROM event_meet WHERE event_id IN (SELECT OLD.event_id)
    UNION SELECT user_high FROM event_meet WHERE event_id IN (SELECT OLD.event_id));
END;

CREATE TRIGGER card_event_meet_after_insert AFTER INSERT ON event_meet

BEGIN
  UPDATE user SET card_image_generation=lower(hex(randomblob(16))), card_image_updated_at=NULL
  WHERE id IN (SELECT user_id FROM event_member WHERE event_id IN (SELECT NEW.event_id)
    UNION SELECT speaker_user_id FROM event_schedule_item WHERE event_id IN (SELECT NEW.event_id)
    UNION SELECT target_key FROM event_like WHERE event_id IN (SELECT NEW.event_id) AND kind IN ('host','staff','participant')
    UNION SELECT user_low FROM event_meet WHERE event_id IN (SELECT NEW.event_id)
    UNION SELECT user_high FROM event_meet WHERE event_id IN (SELECT NEW.event_id));
END;

CREATE TRIGGER card_event_meet_after_update AFTER UPDATE OF event_id,user_low,user_high ON event_meet
WHEN OLD.event_id IS NOT NEW.event_id OR OLD.user_low IS NOT NEW.user_low OR OLD.user_high IS NOT NEW.user_high
BEGIN
  UPDATE user SET card_image_generation=lower(hex(randomblob(16))), card_image_updated_at=NULL
  WHERE id IN (SELECT user_id FROM event_member WHERE event_id IN (SELECT NEW.event_id)
    UNION SELECT speaker_user_id FROM event_schedule_item WHERE event_id IN (SELECT NEW.event_id)
    UNION SELECT target_key FROM event_like WHERE event_id IN (SELECT NEW.event_id) AND kind IN ('host','staff','participant')
    UNION SELECT user_low FROM event_meet WHERE event_id IN (SELECT NEW.event_id)
    UNION SELECT user_high FROM event_meet WHERE event_id IN (SELECT NEW.event_id));
END;

CREATE TRIGGER card_event_track_before_delete BEFORE DELETE ON event_track

BEGIN
  UPDATE user SET card_image_generation=lower(hex(randomblob(16))), card_image_updated_at=NULL
  WHERE id IN (SELECT user_id FROM event_member WHERE event_id IN (SELECT OLD.event_id)
    UNION SELECT speaker_user_id FROM event_schedule_item WHERE event_id IN (SELECT OLD.event_id)
    UNION SELECT target_key FROM event_like WHERE event_id IN (SELECT OLD.event_id) AND kind IN ('host','staff','participant')
    UNION SELECT user_low FROM event_meet WHERE event_id IN (SELECT OLD.event_id)
    UNION SELECT user_high FROM event_meet WHERE event_id IN (SELECT OLD.event_id));
END;

CREATE TRIGGER card_event_track_before_update BEFORE UPDATE OF event_id,visibility ON event_track
WHEN OLD.event_id IS NOT NEW.event_id OR OLD.visibility IS NOT NEW.visibility
BEGIN
  UPDATE user SET card_image_generation=lower(hex(randomblob(16))), card_image_updated_at=NULL
  WHERE id IN (SELECT user_id FROM event_member WHERE event_id IN (SELECT OLD.event_id)
    UNION SELECT speaker_user_id FROM event_schedule_item WHERE event_id IN (SELECT OLD.event_id)
    UNION SELECT target_key FROM event_like WHERE event_id IN (SELECT OLD.event_id) AND kind IN ('host','staff','participant')
    UNION SELECT user_low FROM event_meet WHERE event_id IN (SELECT OLD.event_id)
    UNION SELECT user_high FROM event_meet WHERE event_id IN (SELECT OLD.event_id));
END;

CREATE TRIGGER card_event_track_after_insert AFTER INSERT ON event_track

BEGIN
  UPDATE user SET card_image_generation=lower(hex(randomblob(16))), card_image_updated_at=NULL
  WHERE id IN (SELECT user_id FROM event_member WHERE event_id IN (SELECT NEW.event_id)
    UNION SELECT speaker_user_id FROM event_schedule_item WHERE event_id IN (SELECT NEW.event_id)
    UNION SELECT target_key FROM event_like WHERE event_id IN (SELECT NEW.event_id) AND kind IN ('host','staff','participant')
    UNION SELECT user_low FROM event_meet WHERE event_id IN (SELECT NEW.event_id)
    UNION SELECT user_high FROM event_meet WHERE event_id IN (SELECT NEW.event_id));
END;

CREATE TRIGGER card_event_track_after_update AFTER UPDATE OF event_id,visibility ON event_track
WHEN OLD.event_id IS NOT NEW.event_id OR OLD.visibility IS NOT NEW.visibility
BEGIN
  UPDATE user SET card_image_generation=lower(hex(randomblob(16))), card_image_updated_at=NULL
  WHERE id IN (SELECT user_id FROM event_member WHERE event_id IN (SELECT NEW.event_id)
    UNION SELECT speaker_user_id FROM event_schedule_item WHERE event_id IN (SELECT NEW.event_id)
    UNION SELECT target_key FROM event_like WHERE event_id IN (SELECT NEW.event_id) AND kind IN ('host','staff','participant')
    UNION SELECT user_low FROM event_meet WHERE event_id IN (SELECT NEW.event_id)
    UNION SELECT user_high FROM event_meet WHERE event_id IN (SELECT NEW.event_id));
END;

CREATE TRIGGER card_event_schedule_item_track_before_delete BEFORE DELETE ON event_schedule_item_track

BEGIN
  UPDATE user SET card_image_generation=lower(hex(randomblob(16))), card_image_updated_at=NULL
  WHERE id IN (SELECT user_id FROM event_member WHERE event_id IN (SELECT event_id FROM event_schedule_item WHERE id=OLD.item_id)
    UNION SELECT speaker_user_id FROM event_schedule_item WHERE event_id IN (SELECT event_id FROM event_schedule_item WHERE id=OLD.item_id)
    UNION SELECT target_key FROM event_like WHERE event_id IN (SELECT event_id FROM event_schedule_item WHERE id=OLD.item_id) AND kind IN ('host','staff','participant')
    UNION SELECT user_low FROM event_meet WHERE event_id IN (SELECT event_id FROM event_schedule_item WHERE id=OLD.item_id)
    UNION SELECT user_high FROM event_meet WHERE event_id IN (SELECT event_id FROM event_schedule_item WHERE id=OLD.item_id));
END;

CREATE TRIGGER card_event_schedule_item_track_before_update BEFORE UPDATE OF item_id,track_id ON event_schedule_item_track
WHEN OLD.item_id IS NOT NEW.item_id OR OLD.track_id IS NOT NEW.track_id
BEGIN
  UPDATE user SET card_image_generation=lower(hex(randomblob(16))), card_image_updated_at=NULL
  WHERE id IN (SELECT user_id FROM event_member WHERE event_id IN (SELECT event_id FROM event_schedule_item WHERE id=OLD.item_id)
    UNION SELECT speaker_user_id FROM event_schedule_item WHERE event_id IN (SELECT event_id FROM event_schedule_item WHERE id=OLD.item_id)
    UNION SELECT target_key FROM event_like WHERE event_id IN (SELECT event_id FROM event_schedule_item WHERE id=OLD.item_id) AND kind IN ('host','staff','participant')
    UNION SELECT user_low FROM event_meet WHERE event_id IN (SELECT event_id FROM event_schedule_item WHERE id=OLD.item_id)
    UNION SELECT user_high FROM event_meet WHERE event_id IN (SELECT event_id FROM event_schedule_item WHERE id=OLD.item_id));
END;

CREATE TRIGGER card_event_schedule_item_track_after_insert AFTER INSERT ON event_schedule_item_track

BEGIN
  UPDATE user SET card_image_generation=lower(hex(randomblob(16))), card_image_updated_at=NULL
  WHERE id IN (SELECT user_id FROM event_member WHERE event_id IN (SELECT event_id FROM event_schedule_item WHERE id=NEW.item_id)
    UNION SELECT speaker_user_id FROM event_schedule_item WHERE event_id IN (SELECT event_id FROM event_schedule_item WHERE id=NEW.item_id)
    UNION SELECT target_key FROM event_like WHERE event_id IN (SELECT event_id FROM event_schedule_item WHERE id=NEW.item_id) AND kind IN ('host','staff','participant')
    UNION SELECT user_low FROM event_meet WHERE event_id IN (SELECT event_id FROM event_schedule_item WHERE id=NEW.item_id)
    UNION SELECT user_high FROM event_meet WHERE event_id IN (SELECT event_id FROM event_schedule_item WHERE id=NEW.item_id));
END;

CREATE TRIGGER card_event_schedule_item_track_after_update AFTER UPDATE OF item_id,track_id ON event_schedule_item_track
WHEN OLD.item_id IS NOT NEW.item_id OR OLD.track_id IS NOT NEW.track_id
BEGIN
  UPDATE user SET card_image_generation=lower(hex(randomblob(16))), card_image_updated_at=NULL
  WHERE id IN (SELECT user_id FROM event_member WHERE event_id IN (SELECT event_id FROM event_schedule_item WHERE id=NEW.item_id)
    UNION SELECT speaker_user_id FROM event_schedule_item WHERE event_id IN (SELECT event_id FROM event_schedule_item WHERE id=NEW.item_id)
    UNION SELECT target_key FROM event_like WHERE event_id IN (SELECT event_id FROM event_schedule_item WHERE id=NEW.item_id) AND kind IN ('host','staff','participant')
    UNION SELECT user_low FROM event_meet WHERE event_id IN (SELECT event_id FROM event_schedule_item WHERE id=NEW.item_id)
    UNION SELECT user_high FROM event_meet WHERE event_id IN (SELECT event_id FROM event_schedule_item WHERE id=NEW.item_id));
END;

CREATE TRIGGER card_event_before_delete BEFORE DELETE ON event

BEGIN
  UPDATE user SET card_image_generation=lower(hex(randomblob(16))), card_image_updated_at=NULL
  WHERE id IN (SELECT user_id FROM event_member WHERE event_id IN (SELECT OLD.id)
    UNION SELECT speaker_user_id FROM event_schedule_item WHERE event_id IN (SELECT OLD.id)
    UNION SELECT target_key FROM event_like WHERE event_id IN (SELECT OLD.id) AND kind IN ('host','staff','participant')
    UNION SELECT user_low FROM event_meet WHERE event_id IN (SELECT OLD.id)
    UNION SELECT user_high FROM event_meet WHERE event_id IN (SELECT OLD.id));
END;

CREATE TRIGGER card_event_before_update BEFORE UPDATE OF visibility,status,starts_at,ends_at,attendance_check,community_id,created_by ON event
WHEN OLD.visibility IS NOT NEW.visibility OR OLD.status IS NOT NEW.status OR OLD.starts_at IS NOT NEW.starts_at OR OLD.ends_at IS NOT NEW.ends_at OR OLD.attendance_check IS NOT NEW.attendance_check OR OLD.community_id IS NOT NEW.community_id OR OLD.created_by IS NOT NEW.created_by
BEGIN
  UPDATE user SET card_image_generation=lower(hex(randomblob(16))), card_image_updated_at=NULL
  WHERE id IN (SELECT user_id FROM event_member WHERE event_id IN (SELECT OLD.id)
    UNION SELECT speaker_user_id FROM event_schedule_item WHERE event_id IN (SELECT OLD.id)
    UNION SELECT target_key FROM event_like WHERE event_id IN (SELECT OLD.id) AND kind IN ('host','staff','participant')
    UNION SELECT user_low FROM event_meet WHERE event_id IN (SELECT OLD.id)
    UNION SELECT user_high FROM event_meet WHERE event_id IN (SELECT OLD.id));
END;

CREATE TRIGGER card_event_after_update AFTER UPDATE OF visibility,status,starts_at,ends_at,attendance_check,community_id,created_by ON event
WHEN OLD.visibility IS NOT NEW.visibility OR OLD.status IS NOT NEW.status OR OLD.starts_at IS NOT NEW.starts_at OR OLD.ends_at IS NOT NEW.ends_at OR OLD.attendance_check IS NOT NEW.attendance_check OR OLD.community_id IS NOT NEW.community_id OR OLD.created_by IS NOT NEW.created_by
BEGIN
  UPDATE user SET card_image_generation=lower(hex(randomblob(16))), card_image_updated_at=NULL
  WHERE id IN (SELECT user_id FROM event_member WHERE event_id IN (SELECT NEW.id)
    UNION SELECT speaker_user_id FROM event_schedule_item WHERE event_id IN (SELECT NEW.id)
    UNION SELECT target_key FROM event_like WHERE event_id IN (SELECT NEW.id) AND kind IN ('host','staff','participant')
    UNION SELECT user_low FROM event_meet WHERE event_id IN (SELECT NEW.id)
    UNION SELECT user_high FROM event_meet WHERE event_id IN (SELECT NEW.id));
END;

CREATE TRIGGER card_user_before_delete BEFORE DELETE ON user
BEGIN
  UPDATE user SET card_image_generation=lower(hex(randomblob(16))), card_image_updated_at=NULL
  WHERE id IN (SELECT user_id FROM event_member WHERE event_id IN (SELECT event_id FROM event_member WHERE user_id=OLD.id
      UNION SELECT event_id FROM event_schedule_item WHERE speaker_user_id=OLD.id
      UNION SELECT event_id FROM event_like WHERE user_id=OLD.id OR (kind IN ('host','staff','participant') AND target_key=OLD.id)
      UNION SELECT event_id FROM event_meet WHERE user_low=OLD.id OR user_high=OLD.id)
    UNION SELECT speaker_user_id FROM event_schedule_item WHERE event_id IN (SELECT event_id FROM event_member WHERE user_id=OLD.id
      UNION SELECT event_id FROM event_schedule_item WHERE speaker_user_id=OLD.id
      UNION SELECT event_id FROM event_like WHERE user_id=OLD.id OR (kind IN ('host','staff','participant') AND target_key=OLD.id)
      UNION SELECT event_id FROM event_meet WHERE user_low=OLD.id OR user_high=OLD.id)
    UNION SELECT target_key FROM event_like WHERE event_id IN (SELECT event_id FROM event_member WHERE user_id=OLD.id
      UNION SELECT event_id FROM event_schedule_item WHERE speaker_user_id=OLD.id
      UNION SELECT event_id FROM event_like WHERE user_id=OLD.id OR (kind IN ('host','staff','participant') AND target_key=OLD.id)
      UNION SELECT event_id FROM event_meet WHERE user_low=OLD.id OR user_high=OLD.id) AND kind IN ('host','staff','participant')
    UNION SELECT user_low FROM event_meet WHERE event_id IN (SELECT event_id FROM event_member WHERE user_id=OLD.id
      UNION SELECT event_id FROM event_schedule_item WHERE speaker_user_id=OLD.id
      UNION SELECT event_id FROM event_like WHERE user_id=OLD.id OR (kind IN ('host','staff','participant') AND target_key=OLD.id)
      UNION SELECT event_id FROM event_meet WHERE user_low=OLD.id OR user_high=OLD.id)
    UNION SELECT user_high FROM event_meet WHERE event_id IN (SELECT event_id FROM event_member WHERE user_id=OLD.id
      UNION SELECT event_id FROM event_schedule_item WHERE speaker_user_id=OLD.id
      UNION SELECT event_id FROM event_like WHERE user_id=OLD.id OR (kind IN ('host','staff','participant') AND target_key=OLD.id)
      UNION SELECT event_id FROM event_meet WHERE user_low=OLD.id OR user_high=OLD.id));
END;

CREATE TRIGGER card_user_after_update AFTER UPDATE OF deleted_at ON user
WHEN OLD.deleted_at IS NOT NEW.deleted_at
BEGIN
  UPDATE user SET card_image_generation=lower(hex(randomblob(16))), card_image_updated_at=NULL
  WHERE id=NEW.id OR id IN (SELECT user_id FROM event_member WHERE event_id IN (SELECT event_id FROM event_member WHERE user_id=NEW.id
      UNION SELECT event_id FROM event_schedule_item WHERE speaker_user_id=NEW.id
      UNION SELECT event_id FROM event_like WHERE user_id=NEW.id OR (kind IN ('host','staff','participant') AND target_key=NEW.id)
      UNION SELECT event_id FROM event_meet WHERE user_low=NEW.id OR user_high=NEW.id)
    UNION SELECT speaker_user_id FROM event_schedule_item WHERE event_id IN (SELECT event_id FROM event_member WHERE user_id=NEW.id
      UNION SELECT event_id FROM event_schedule_item WHERE speaker_user_id=NEW.id
      UNION SELECT event_id FROM event_like WHERE user_id=NEW.id OR (kind IN ('host','staff','participant') AND target_key=NEW.id)
      UNION SELECT event_id FROM event_meet WHERE user_low=NEW.id OR user_high=NEW.id)
    UNION SELECT target_key FROM event_like WHERE event_id IN (SELECT event_id FROM event_member WHERE user_id=NEW.id
      UNION SELECT event_id FROM event_schedule_item WHERE speaker_user_id=NEW.id
      UNION SELECT event_id FROM event_like WHERE user_id=NEW.id OR (kind IN ('host','staff','participant') AND target_key=NEW.id)
      UNION SELECT event_id FROM event_meet WHERE user_low=NEW.id OR user_high=NEW.id) AND kind IN ('host','staff','participant')
    UNION SELECT user_low FROM event_meet WHERE event_id IN (SELECT event_id FROM event_member WHERE user_id=NEW.id
      UNION SELECT event_id FROM event_schedule_item WHERE speaker_user_id=NEW.id
      UNION SELECT event_id FROM event_like WHERE user_id=NEW.id OR (kind IN ('host','staff','participant') AND target_key=NEW.id)
      UNION SELECT event_id FROM event_meet WHERE user_low=NEW.id OR user_high=NEW.id)
    UNION SELECT user_high FROM event_meet WHERE event_id IN (SELECT event_id FROM event_member WHERE user_id=NEW.id
      UNION SELECT event_id FROM event_schedule_item WHERE speaker_user_id=NEW.id
      UNION SELECT event_id FROM event_like WHERE user_id=NEW.id OR (kind IN ('host','staff','participant') AND target_key=NEW.id)
      UNION SELECT event_id FROM event_meet WHERE user_low=NEW.id OR user_high=NEW.id));
END;

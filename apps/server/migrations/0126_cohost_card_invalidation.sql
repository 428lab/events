-- 共催も主催と同じく所属に数える (docs/event-cohost.md §6、オーナー決定 2026-11-13)。
-- プロフィールカードの所属コミュニティは主催と承認済みの共催から出るので、
-- 共催が成立する・外れるときも、主催が変わったとき (0092 card_event_*_update の community_id)
-- と同じ範囲のカードを古くする。承認待ちの行は所属に効かないので見ない。
-- card_image_generation を見る列は無いので、再帰的に失効しない（0092 と同じ）。

CREATE TRIGGER card_event_cohost_after_insert AFTER INSERT ON event_cohost
WHEN NEW.status = 'accepted'
BEGIN
  UPDATE user SET card_image_generation=lower(hex(randomblob(16))), card_image_updated_at=NULL
  WHERE id IN (SELECT user_id FROM event_member WHERE event_id IN (SELECT NEW.event_id)
    UNION SELECT speaker_user_id FROM event_schedule_item WHERE event_id IN (SELECT NEW.event_id)
    UNION SELECT target_key FROM event_like WHERE event_id IN (SELECT NEW.event_id) AND kind IN ('host','staff','participant')
    UNION SELECT user_low FROM event_meet WHERE event_id IN (SELECT NEW.event_id)
    UNION SELECT user_high FROM event_meet WHERE event_id IN (SELECT NEW.event_id));
END;

CREATE TRIGGER card_event_cohost_after_update AFTER UPDATE OF status, community_id, event_id ON event_cohost
WHEN OLD.status IS NOT NEW.status OR OLD.community_id IS NOT NEW.community_id OR OLD.event_id IS NOT NEW.event_id
BEGIN
  UPDATE user SET card_image_generation=lower(hex(randomblob(16))), card_image_updated_at=NULL
  WHERE id IN (SELECT user_id FROM event_member WHERE event_id IN (SELECT NEW.event_id UNION SELECT OLD.event_id)
    UNION SELECT speaker_user_id FROM event_schedule_item WHERE event_id IN (SELECT NEW.event_id UNION SELECT OLD.event_id)
    UNION SELECT target_key FROM event_like WHERE event_id IN (SELECT NEW.event_id UNION SELECT OLD.event_id) AND kind IN ('host','staff','participant')
    UNION SELECT user_low FROM event_meet WHERE event_id IN (SELECT NEW.event_id UNION SELECT OLD.event_id)
    UNION SELECT user_high FROM event_meet WHERE event_id IN (SELECT NEW.event_id UNION SELECT OLD.event_id));
END;

CREATE TRIGGER card_event_cohost_before_delete BEFORE DELETE ON event_cohost
WHEN OLD.status = 'accepted'
BEGIN
  UPDATE user SET card_image_generation=lower(hex(randomblob(16))), card_image_updated_at=NULL
  WHERE id IN (SELECT user_id FROM event_member WHERE event_id IN (SELECT OLD.event_id)
    UNION SELECT speaker_user_id FROM event_schedule_item WHERE event_id IN (SELECT OLD.event_id)
    UNION SELECT target_key FROM event_like WHERE event_id IN (SELECT OLD.event_id) AND kind IN ('host','staff','participant')
    UNION SELECT user_low FROM event_meet WHERE event_id IN (SELECT OLD.event_id)
    UNION SELECT user_high FROM event_meet WHERE event_id IN (SELECT OLD.event_id));
END;

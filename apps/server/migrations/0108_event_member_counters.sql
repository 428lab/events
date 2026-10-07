-- D-POLL-MIN Phase 4: store member counts on event / participation_slot instead of
-- recounting event_member on every read.
--
-- Before this, findById and every event list ran PARTICIPANT_COUNT_SQL / ATTENDED_COUNT_SQL /
-- CAPACITY_TOTAL_SQL per event (about 4 rows per confirmed member), and the slot reads ran
-- three COUNTs per slot. The triggers below keep the cnt_* columns exactly equal to those
-- COUNT queries (which stay in events.ts as the test oracle and in
-- scripts/check-member-counters.sql), so a read costs one row per event / slot.
--
-- Capacity enforcement does NOT read these columns: join / waitlist / lottery keep their
-- exact COUNT(*) inside the write statement, so a counter bug can only show a wrong number.
--
-- CAVEAT: never write `INSERT OR REPLACE` / `REPLACE INTO` on event_member,
-- participation_slot or user. REPLACE deletes the old row without firing DELETE triggers
-- (recursive_triggers is off), so the counters would drift. Use INSERT ... ON CONFLICT
-- DO UPDATE instead (that fires the UPDATE trigger). test/event-member-counters.test.ts
-- guards this.
--
-- Deleted users (#250): event counts exclude members whose user.deleted_at is set
-- (COUNTED_MEMBER_IS_ACTIVE); slot counts include them (SELECT_SLOT never filtered them).
-- On a user/event FK cascade the parent row is already gone when the event_member
-- AFTER DELETE trigger runs, so its EXISTS(user) guard is false; count_user_before_delete
-- subtracts the user's contribution before the cascade instead.

ALTER TABLE event ADD COLUMN cnt_participants INTEGER NOT NULL DEFAULT 0;
ALTER TABLE event ADD COLUMN cnt_attended INTEGER NOT NULL DEFAULT 0;
ALTER TABLE event ADD COLUMN cnt_unslotted_confirmed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE event ADD COLUMN cnt_slots INTEGER NOT NULL DEFAULT 0;
ALTER TABLE event ADD COLUMN cnt_slot_capacity INTEGER NOT NULL DEFAULT 0;
ALTER TABLE participation_slot ADD COLUMN cnt_confirmed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE participation_slot ADD COLUMN cnt_waitlist INTEGER NOT NULL DEFAULT 0;
ALTER TABLE participation_slot ADD COLUMN cnt_applied INTEGER NOT NULL DEFAULT 0;

-- backfill (same predicates as PARTICIPANT_COUNT_SQL / ATTENDED_COUNT_SQL / CAPACITY_TOTAL_SQL / SELECT_SLOT)
UPDATE event SET
  cnt_participants = (SELECT COUNT(1) FROM event_member em WHERE em.event_id = event.id AND em.status = 'confirmed'
    AND EXISTS (SELECT 1 FROM user u WHERE u.id = em.user_id AND u.deleted_at IS NULL)),
  cnt_attended = (SELECT COUNT(1) FROM event_member em WHERE em.event_id = event.id AND em.status = 'confirmed' AND em.attended = 1
    AND EXISTS (SELECT 1 FROM user u WHERE u.id = em.user_id AND u.deleted_at IS NULL)),
  cnt_unslotted_confirmed = (SELECT COUNT(1) FROM event_member em WHERE em.event_id = event.id AND em.status = 'confirmed' AND em.slot_id IS NULL
    AND EXISTS (SELECT 1 FROM user u WHERE u.id = em.user_id AND u.deleted_at IS NULL)),
  cnt_slots = (SELECT COUNT(1) FROM participation_slot s WHERE s.event_id = event.id),
  cnt_slot_capacity = (SELECT COALESCE(SUM(s.capacity), 0) FROM participation_slot s WHERE s.event_id = event.id);
UPDATE participation_slot SET
  cnt_confirmed = (SELECT COUNT(1) FROM event_member m WHERE m.slot_id = participation_slot.id AND m.status = 'confirmed'),
  cnt_waitlist  = (SELECT COUNT(1) FROM event_member m WHERE m.slot_id = participation_slot.id AND m.status = 'waitlist'),
  cnt_applied   = (SELECT COUNT(1) FROM event_member m WHERE m.slot_id = participation_slot.id AND m.status = 'applied');

-- event_member: insert
CREATE TRIGGER count_event_member_after_insert AFTER INSERT ON event_member
BEGIN
  UPDATE event SET
    cnt_participants = cnt_participants + 1,
    cnt_attended = cnt_attended + (NEW.attended = 1),
    cnt_unslotted_confirmed = cnt_unslotted_confirmed + (NEW.slot_id IS NULL)
  WHERE id = NEW.event_id AND NEW.status = 'confirmed'
    AND EXISTS (SELECT 1 FROM user u WHERE u.id = NEW.user_id AND u.deleted_at IS NULL);
  UPDATE participation_slot SET
    cnt_confirmed = cnt_confirmed + (NEW.status = 'confirmed'),
    cnt_waitlist = cnt_waitlist + (NEW.status = 'waitlist'),
    cnt_applied = cnt_applied + (NEW.status = 'applied')
  WHERE id = NEW.slot_id;
END;

-- event_member: delete. During a user/event FK cascade the parent row is already gone,
-- so the EXISTS(user) guard is false and the user BEFORE DELETE trigger owns that case.
CREATE TRIGGER count_event_member_after_delete AFTER DELETE ON event_member
BEGIN
  UPDATE event SET
    cnt_participants = cnt_participants - 1,
    cnt_attended = cnt_attended - (OLD.attended = 1),
    cnt_unslotted_confirmed = cnt_unslotted_confirmed - (OLD.slot_id IS NULL)
  WHERE id = OLD.event_id AND OLD.status = 'confirmed'
    AND EXISTS (SELECT 1 FROM user u WHERE u.id = OLD.user_id AND u.deleted_at IS NULL);
  UPDATE participation_slot SET
    cnt_confirmed = cnt_confirmed - (OLD.status = 'confirmed'),
    cnt_waitlist = cnt_waitlist - (OLD.status = 'waitlist'),
    cnt_applied = cnt_applied - (OLD.status = 'applied')
  WHERE id = OLD.slot_id;
END;

-- event_member: update (also fires for ON DELETE SET NULL of slot_id)
CREATE TRIGGER count_event_member_after_update AFTER UPDATE OF event_id, user_id, status, attended, slot_id ON event_member
WHEN OLD.event_id IS NOT NEW.event_id OR OLD.user_id IS NOT NEW.user_id OR OLD.status IS NOT NEW.status
  OR OLD.attended IS NOT NEW.attended OR OLD.slot_id IS NOT NEW.slot_id
BEGIN
  UPDATE event SET
    cnt_participants = cnt_participants - 1,
    cnt_attended = cnt_attended - (OLD.attended = 1),
    cnt_unslotted_confirmed = cnt_unslotted_confirmed - (OLD.slot_id IS NULL)
  WHERE id = OLD.event_id AND OLD.status = 'confirmed'
    AND EXISTS (SELECT 1 FROM user u WHERE u.id = OLD.user_id AND u.deleted_at IS NULL);
  UPDATE event SET
    cnt_participants = cnt_participants + 1,
    cnt_attended = cnt_attended + (NEW.attended = 1),
    cnt_unslotted_confirmed = cnt_unslotted_confirmed + (NEW.slot_id IS NULL)
  WHERE id = NEW.event_id AND NEW.status = 'confirmed'
    AND EXISTS (SELECT 1 FROM user u WHERE u.id = NEW.user_id AND u.deleted_at IS NULL);
  UPDATE participation_slot SET
    cnt_confirmed = cnt_confirmed - (OLD.status = 'confirmed'),
    cnt_waitlist = cnt_waitlist - (OLD.status = 'waitlist'),
    cnt_applied = cnt_applied - (OLD.status = 'applied')
  WHERE id = OLD.slot_id;
  UPDATE participation_slot SET
    cnt_confirmed = cnt_confirmed + (NEW.status = 'confirmed'),
    cnt_waitlist = cnt_waitlist + (NEW.status = 'waitlist'),
    cnt_applied = cnt_applied + (NEW.status = 'applied')
  WHERE id = NEW.slot_id;
END;

-- user soft delete / restore (#250)
CREATE TRIGGER count_user_after_deleted_at AFTER UPDATE OF deleted_at ON user
WHEN (OLD.deleted_at IS NULL) <> (NEW.deleted_at IS NULL)
BEGIN
  UPDATE event SET
    cnt_participants = cnt_participants + (CASE WHEN NEW.deleted_at IS NULL THEN 1 ELSE -1 END),
    cnt_attended = cnt_attended + (CASE WHEN NEW.deleted_at IS NULL THEN 1 ELSE -1 END)
      * (SELECT COUNT(1) FROM event_member em WHERE em.event_id = event.id AND em.user_id = NEW.id AND em.status = 'confirmed' AND em.attended = 1),
    cnt_unslotted_confirmed = cnt_unslotted_confirmed + (CASE WHEN NEW.deleted_at IS NULL THEN 1 ELSE -1 END)
      * (SELECT COUNT(1) FROM event_member em WHERE em.event_id = event.id AND em.user_id = NEW.id AND em.status = 'confirmed' AND em.slot_id IS NULL)
  WHERE id IN (SELECT event_id FROM event_member WHERE user_id = NEW.id AND status = 'confirmed');
END;

-- user hard delete while still active (deleteById, merge loser). Runs before the FK cascade.
CREATE TRIGGER count_user_before_delete BEFORE DELETE ON user
WHEN OLD.deleted_at IS NULL
BEGIN
  UPDATE event SET
    cnt_participants = cnt_participants - 1,
    cnt_attended = cnt_attended
      - (SELECT COUNT(1) FROM event_member em WHERE em.event_id = event.id AND em.user_id = OLD.id AND em.status = 'confirmed' AND em.attended = 1),
    cnt_unslotted_confirmed = cnt_unslotted_confirmed
      - (SELECT COUNT(1) FROM event_member em WHERE em.event_id = event.id AND em.user_id = OLD.id AND em.status = 'confirmed' AND em.slot_id IS NULL)
  WHERE id IN (SELECT event_id FROM event_member WHERE user_id = OLD.id AND status = 'confirmed');
END;

-- participation_slot -> event.cnt_slots / cnt_slot_capacity
CREATE TRIGGER count_slot_after_insert AFTER INSERT ON participation_slot
BEGIN
  UPDATE event SET cnt_slots = cnt_slots + 1, cnt_slot_capacity = cnt_slot_capacity + NEW.capacity WHERE id = NEW.event_id;
END;
CREATE TRIGGER count_slot_after_delete AFTER DELETE ON participation_slot
BEGIN
  UPDATE event SET cnt_slots = cnt_slots - 1, cnt_slot_capacity = cnt_slot_capacity - OLD.capacity WHERE id = OLD.event_id;
END;
CREATE TRIGGER count_slot_after_update AFTER UPDATE OF capacity, event_id ON participation_slot
WHEN OLD.capacity IS NOT NEW.capacity OR OLD.event_id IS NOT NEW.event_id
BEGIN
  UPDATE event SET cnt_slots = cnt_slots - 1, cnt_slot_capacity = cnt_slot_capacity - OLD.capacity WHERE id = OLD.event_id;
  UPDATE event SET cnt_slots = cnt_slots + 1, cnt_slot_capacity = cnt_slot_capacity + NEW.capacity WHERE id = NEW.event_id;
END;

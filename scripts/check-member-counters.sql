-- D-POLL-MIN Phase 4: consistency check for the 0108 member counters (read-only).
--
-- Lists every event / participation_slot whose stored cnt_* column differs from the
-- COUNT it replaces (PARTICIPANT_COUNT_SQL / ATTENDED_COUNT_SQL / CAPACITY_TOTAL_SQL in
-- apps/server/src/db/repositories/events.ts, SLOT_MEMBER_COUNT_SQL in participationSlots.ts).
-- Expected result: 0 rows.
--
--   CLOUDFLARE_ACCOUNT_ID=... npx wrangler d1 execute eventer-staging --env staging --remote \
--     --file scripts/check-member-counters.sql
--
-- One full pass over event_member; run it manually only (after applying 0108, after
-- checks, and right after the production apply). To re-sync after a trigger bug, rerun the
-- backfill UPDATEs from apps/server/migrations/0108_event_member_counters.sql.
SELECT 'event' AS kind, e.id AS id FROM event e WHERE
     e.cnt_participants <> (SELECT COUNT(1) FROM event_member em WHERE em.event_id = e.id AND em.status = 'confirmed'
       AND EXISTS (SELECT 1 FROM user u WHERE u.id = em.user_id AND u.deleted_at IS NULL))
  OR e.cnt_attended <> (SELECT COUNT(1) FROM event_member em WHERE em.event_id = e.id AND em.status = 'confirmed' AND em.attended = 1
       AND EXISTS (SELECT 1 FROM user u WHERE u.id = em.user_id AND u.deleted_at IS NULL))
  OR e.cnt_unslotted_confirmed <> (SELECT COUNT(1) FROM event_member em WHERE em.event_id = e.id AND em.status = 'confirmed' AND em.slot_id IS NULL
       AND EXISTS (SELECT 1 FROM user u WHERE u.id = em.user_id AND u.deleted_at IS NULL))
  OR e.cnt_slots <> (SELECT COUNT(1) FROM participation_slot s WHERE s.event_id = e.id)
  OR e.cnt_slot_capacity <> (SELECT COALESCE(SUM(s.capacity), 0) FROM participation_slot s WHERE s.event_id = e.id)
UNION ALL
SELECT 'slot' AS kind, s.id AS id FROM participation_slot s WHERE
     s.cnt_confirmed <> (SELECT COUNT(1) FROM event_member m WHERE m.slot_id = s.id AND m.status = 'confirmed')
  OR s.cnt_waitlist <> (SELECT COUNT(1) FROM event_member m WHERE m.slot_id = s.id AND m.status = 'waitlist')
  OR s.cnt_applied <> (SELECT COUNT(1) FROM event_member m WHERE m.slot_id = s.id AND m.status = 'applied');

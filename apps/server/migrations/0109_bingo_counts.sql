-- D-POLL-MIN Phase 5b (decision D3): store the participant counts on event_bingo_game so
-- GET /events/:id/bingo reads one game row and the caller's card instead of every card.
-- Every draw signals the card pages and projectors (topic `bingo`), and up to every
-- participant refetches, so an O(cards) read per refetch would cost viewers x cards rows.
--
-- card_count / bingo_count / reach_count: the counts derived from every card (bingoTotals).
-- bingo_by_seq: JSON array, element i = number of cards whose first line completed at
--   draw i+1 (at most 75 entries). A participant's competition rank is
--   1 + sum(bingo_by_seq[0 .. mySeq-2]), the same rule as statusRows.
--
-- Draw, undo and reset write absolute values from a full derivation; card issue adds its
-- own card. These are display numbers only: no prize or rank check reads them (prize
-- redemption and the staff list still derive from the cards).
-- Existing games get card_count below; bingo/reach start at 0 and are corrected by the
-- game's next draw or undo.
ALTER TABLE event_bingo_game ADD COLUMN card_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE event_bingo_game ADD COLUMN bingo_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE event_bingo_game ADD COLUMN reach_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE event_bingo_game ADD COLUMN bingo_by_seq TEXT NOT NULL DEFAULT '[]';

-- Cards already issued (same exclusion of deleted users as the derivation).
UPDATE event_bingo_game SET card_count = (
  SELECT COUNT(*) FROM event_bingo_card c JOIN user u ON u.id = c.user_id AND u.deleted_at IS NULL
   WHERE c.event_id = event_bingo_game.event_id);

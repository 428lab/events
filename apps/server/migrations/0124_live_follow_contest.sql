-- 配信をコンテストの発表に連動させる（オーナー決定 2026-11-13、docs/contest-organizer-ux.md「配信との連動」）。
--
-- follow_contest = 1 のあいだ、配信画面のスライドは進行画面で選んだ発表中のエントリーのスライド
-- （運営が選んだスライド、なければ成果物の資料URLの /d/:slug）になり、ページは発表のページめくり
-- （Nostr kind 21080）に合わせる。リレーに届かない配信画面は deck_page（運営が最後に保存したページ）を出す。
-- deck_id / presenter_item_id はそのまま残す（連動を切ると元の選択に戻る）。
ALTER TABLE event_live_state ADD COLUMN follow_contest INTEGER NOT NULL DEFAULT 0;

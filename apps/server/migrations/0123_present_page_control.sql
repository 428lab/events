-- 発表のページめくりを発表者に渡す（オーナー決定 2026-11-13、docs/contest-organizer-ux.md）。
--
-- present_deck_slug: 運営が選んだ発表スライド（/d/:slug の slug）。NULL は「成果物の資料URLから引く」(#670)。
-- present_control: 'staff'（運営がめくる）／ 'presenter'（発表中のエントリーのメンバーがめくる）。
-- present_control_version: 渡す・戻す・発表やスライドが変わるたびに 1 増やす。宛先（topic）もこれで変わる。
-- present_control_secret: その世代のページめくりの署名鍵（secp256k1 秘密鍵 hex）。めくれる人にだけ返す。
--   見ている側は公開鍵で署名を確かめる。世代が変わると前の鍵の署名は受け付けない。
-- めくるたびの DB 書き込みは無い（ページ番号は Nostr のエフェメラルイベント kind 21080 で送る）。
ALTER TABLE event_state ADD COLUMN present_deck_slug TEXT;
ALTER TABLE event_state ADD COLUMN present_control TEXT NOT NULL DEFAULT 'staff';
ALTER TABLE event_state ADD COLUMN present_control_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE event_state ADD COLUMN present_control_secret TEXT;

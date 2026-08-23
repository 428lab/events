-- 公開プロフィールの写真ギャラリーのページング用 (#407)。
-- event_photo の索引は (event_id, created_at) だけで user_id の索引が無く、
-- 本人の写真一覧は全走査だった。ページング化で毎ページ叩くようになるのでここで足す。
-- イベント別・コミュニティ別・期間のフィルタは、この索引で本人の写真に絞った後の
-- JOIN・フィルタで足りる（1ユーザーの写真数は高々数百のオーダー）
CREATE INDEX idx_event_photo_user ON event_photo(user_id, created_at);

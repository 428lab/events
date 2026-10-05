-- イベントの会場の住所。venue_offline は会場名のまま、住所はこの列に分けて持つ。
-- 住所があるときだけイベントページに地図を出す
ALTER TABLE event ADD COLUMN venue_address TEXT;

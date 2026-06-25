-- コンテスト形式トグル。新規は既定オフ（一般イベント）。
ALTER TABLE event ADD COLUMN contest_mode INTEGER NOT NULL DEFAULT 0;

-- 既存イベントは従来どおり採点・表彰を使う想定なのでオンに移行。
UPDATE event SET contest_mode = 1;

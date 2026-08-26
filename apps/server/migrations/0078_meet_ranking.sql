-- 出会いランキングの表示設定 (#418)。
-- off=出さない（表示・APIとも存在ごと隠す） / anonymous=件数のみ / named=名前入り
ALTER TABLE event ADD COLUMN meet_ranking TEXT NOT NULL DEFAULT 'off';

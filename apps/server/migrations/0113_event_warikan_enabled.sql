-- 割り勘 (#556) のオン/オフ (#635)。既定はオフ。使うイベントだけスタッフが編集画面でオンにする
ALTER TABLE event ADD COLUMN warikan_enabled INTEGER NOT NULL DEFAULT 0;
-- 既に立替のあるイベントは、帳簿が見えなくならないようオンにしておく
UPDATE event SET warikan_enabled = 1 WHERE id IN (SELECT DISTINCT event_id FROM event_expense);

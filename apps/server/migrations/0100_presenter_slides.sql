-- #571 登壇者本人がこのコマに紐付けた配信用デッキ（このイベント・このコマ限定の、運営スタッフへの表示の同意）
ALTER TABLE event_schedule_item ADD COLUMN live_deck_id TEXT REFERENCES deck(id) ON DELETE SET NULL;
-- #571 配信コントロールでいま選ばれている発表（コマ）
ALTER TABLE event_live_state ADD COLUMN presenter_item_id TEXT REFERENCES event_schedule_item(id) ON DELETE SET NULL;

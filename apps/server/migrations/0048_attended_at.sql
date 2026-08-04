-- 入館名簿CSV (#154): 出席チェックした時刻（epoch ms）。未出席は NULL
ALTER TABLE event_member ADD COLUMN attended_at INTEGER;

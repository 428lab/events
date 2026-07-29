-- 会場マッチング (#53 PR2): 会場募集フラグと双方向オファー
ALTER TABLE event ADD COLUMN venue_wanted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE event_request ADD COLUMN venue_wanted INTEGER NOT NULL DEFAULT 0;

-- オファー（定型アクションのみ・自由メッセージなし=通信の媒介を避ける）
CREATE TABLE venue_offer (
  id TEXT PRIMARY KEY,
  venue_id TEXT NOT NULL REFERENCES venue(id) ON DELETE CASCADE,
  event_id TEXT REFERENCES event(id) ON DELETE CASCADE,          -- event か request のどちらか一方
  request_id TEXT REFERENCES event_request(id) ON DELETE CASCADE,
  direction TEXT NOT NULL,               -- venue_to_event(会場側から) / event_to_venue(主催者側から)
  status TEXT NOT NULL DEFAULT 'pending',-- pending / accepted / declined
  organizer_contact TEXT NOT NULL DEFAULT '', -- 主催者側の連絡先（承諾成立後に会場側へ開示）
  created_by TEXT NOT NULL REFERENCES user(id),
  created_at INTEGER NOT NULL,
  responded_at INTEGER
);
CREATE INDEX idx_venue_offer_venue ON venue_offer(venue_id, status);
CREATE INDEX idx_venue_offer_event ON venue_offer(event_id);
CREATE INDEX idx_venue_offer_request ON venue_offer(request_id);

-- イベントのたまご: 「あったらいいな」リクエストと開催マッチング (#29)
CREATE TABLE event_request (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  venue_type_pref TEXT,                     -- offline/online/hybrid/NULL(こだわらない)
  -- コミュニティ削除時は全体たまご化（repo 側で members_only も外す。SET NULL はバックストップ）
  community_id TEXT REFERENCES community(id) ON DELETE SET NULL,
  members_only INTEGER NOT NULL DEFAULT 0,  -- コミュニティ内のみ有効（メンバー以外に見せない）
  status TEXT NOT NULL DEFAULT 'open',      -- open/closed
  created_by TEXT NOT NULL REFERENCES user(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_event_request_status ON event_request(status, created_at);
CREATE INDEX idx_event_request_community ON event_request(community_id, status);

-- 賛同（参加したい attend / 開催してもいい host）
-- user は CASCADE: アカウント統合(mergeInto)の残骸行を from ユーザー削除時に掃除する
CREATE TABLE event_request_reaction (
  request_id TEXT NOT NULL REFERENCES event_request(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                       -- attend/host
  created_at INTEGER NOT NULL,
  PRIMARY KEY (request_id, user_id, kind)
);

-- 開催宣言でリンクされたイベント（1リクエスト:多イベント）
CREATE TABLE event_request_event (
  request_id TEXT NOT NULL REFERENCES event_request(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  notified_at INTEGER NOT NULL DEFAULT 0,  -- 賛同者へ通知済み（イベント公開時に1回だけ）
  PRIMARY KEY (request_id, event_id)
);
CREATE INDEX idx_event_request_event_event ON event_request_event(event_id);

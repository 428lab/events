-- 配信画面ツール: 配信セット（シーン一式）・イベント配信状態・BGMトラック

-- 配信セット。デッキと同型のオーナーシップ（ユーザー資産、任意でコミュニティ共有）
CREATE TABLE live_set (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES user(id),
  community_id TEXT REFERENCES community(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  content TEXT NOT NULL, -- JSON: { scenes: [...] }
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_live_set_owner ON live_set(owner_id);
CREATE INDEX idx_live_set_community ON live_set(community_id);

-- イベントごとの配信ランタイム状態（コントロールタブ→配信画面タブの同期点）
CREATE TABLE event_live_state (
  event_id TEXT PRIMARY KEY REFERENCES event(id) ON DELETE CASCADE,
  live_set_id TEXT REFERENCES live_set(id) ON DELETE SET NULL,
  active_scene_id TEXT,
  deck_id TEXT REFERENCES deck(id) ON DELETE SET NULL,
  deck_page INTEGER NOT NULL DEFAULT 0,
  bgm_track_id TEXT,
  bgm_playing INTEGER NOT NULL DEFAULT 0,
  bgm_volume REAL NOT NULL DEFAULT 0.5,
  updated_at INTEGER NOT NULL
);

-- BGMトラック（owner_id NULL はビルトイン曲）
CREATE TABLE bgm_track (
  id TEXT PRIMARY KEY,
  owner_id TEXT REFERENCES user(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  credit_text TEXT NOT NULL, -- YouTube概要欄に貼るクレジット（出典・ライセンス）
  r2_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_bgm_track_owner ON bgm_track(owner_id);

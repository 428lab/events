-- ユーザーフォロー (#21 PR1) ＋ フォロワー通知の重複防止 (#21 PR2)
CREATE TABLE user_follow (
  follower_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  followee_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (follower_id, followee_id)
);
CREATE INDEX idx_follow_followee ON user_follow(followee_id);

-- イベント公開時のフォロワー通知を1回だけにする（再公開で再通知しない）
ALTER TABLE event ADD COLUMN followers_notified_at INTEGER NOT NULL DEFAULT 0;
-- 既に公開済みのイベントは「通知済み」扱いにする（デプロイ後の編集で偽の公開通知が飛ばないように）
UPDATE event SET followers_notified_at = 1 WHERE status = 'published';

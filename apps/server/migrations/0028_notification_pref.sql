-- 通知設定 (#21 PR3)。行が無ければ既定値（フォロー通知ON・メールOFF）
CREATE TABLE notification_pref (
  user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
  followee_created INTEGER NOT NULL DEFAULT 1,  -- フォロー相手のイベント公開通知
  followee_joined INTEGER NOT NULL DEFAULT 1,   -- フォロー相手のイベント参加通知
  email_enabled INTEGER NOT NULL DEFAULT 0,     -- メール通知（PR4 で使用。予約）
  updated_at INTEGER NOT NULL
);

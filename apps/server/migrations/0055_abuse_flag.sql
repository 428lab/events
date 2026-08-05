-- 異常行動の検知 (#259 PR2)。日次バッチ (POST /api/cron/detect-abuse) が
-- 既存データからルールを評価し、引っかかった対象をここに記録する。
-- 自動制限はしない。運営が目視して「確認済み」にするための **要確認** リスト。
--
-- user への FK は張らない（退会・統合でユーザー行が消えても記録を残すため。
-- 監査ログ #248 と同じ方針）。detail には件数やIDなどの最小限だけを入れ、
-- メール・本文などの個人情報は入れないこと。
CREATE TABLE abuse_flag (
  id TEXT PRIMARY KEY,
  rule TEXT NOT NULL,               -- event_burst / egg_burst / comment_burst /
                                    -- new_account_burst / empty_event_spam /
                                    -- cancel_burst / signup_spike
  subject_user_id TEXT,             -- サービス全体の異常(signup_spike)は NULL
  subject_handle TEXT NOT NULL DEFAULT '',  -- 検知時点のハンドル（後から辿れるように）
  detail TEXT NOT NULL DEFAULT '',  -- JSON文字列（個人情報は入れない）
  detected_at INTEGER NOT NULL,
  reviewed_at INTEGER,              -- NULL = 未確認
  reviewed_by TEXT                  -- 確認した運営管理者の user id（FKは張らない）
);

-- 一覧（未確認を上に・新しい順）。reviewed_at IS NULL の未確認だけを引く絞り込みと、
-- 未確認件数のバッジ（COUNT）に効く。大多数は確認済みになっていくので、
-- バッジ用には未確認だけの部分インデックスを別に置く
CREATE INDEX idx_abuse_flag_reviewed ON abuse_flag(reviewed_at, detected_at DESC);
CREATE INDEX idx_abuse_flag_unreviewed ON abuse_flag(detected_at DESC)
  WHERE reviewed_at IS NULL;

-- 重複抑制 (ABUSE_FLAG_COOLDOWN_MS)。同じ subject × 同じ rule の直近の記録を探す。
-- 保存期間切れの掃除 (detected_at < ?) にも使える
CREATE INDEX idx_abuse_flag_dedupe ON abuse_flag(rule, subject_user_id, detected_at DESC);

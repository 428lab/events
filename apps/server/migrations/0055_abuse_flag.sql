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

-- 重複抑制 (ABUSE_FLAG_COOLDOWN_MS)。**未確認 (reviewed_at IS NULL) の記録だけ**を
-- 直近ぶん引くので、部分インデックスにして detected_at の範囲検索を効かせる。
-- 「確認済みにしたら翌日また検知される」= 継続中の荒らしを追える、という設計
-- （正当なヘビーユーザーの恒久的な抑制は abuse_allowlist で行う）
CREATE INDEX idx_abuse_flag_cooldown ON abuse_flag(detected_at)
  WHERE reviewed_at IS NULL;

-- 保存期間切れの掃除 (DELETE ... WHERE detected_at < ?) 用。
-- 上の部分インデックスは未確認しか含まないので掃除には使えない
CREATE INDEX idx_abuse_flag_detected ON abuse_flag(detected_at);

-- 検知の抑制リスト (#259 レビュー反映)。毎週イベントを開く主催者のような
-- 正当なヘビーユーザーは、確認済みにしてもクールダウンが切れれば再検知される。
-- ここに入れた user × rule は検知の段階で落とす（＝二度と通知が飛ばない）。
--
-- rule が NULL なら全ルールを抑制する。abuse_flag と同じく user への FK は張らない。
-- note は運営が書く自由記述（「毎週の定例イベント主催者」など）。
-- 個人情報を書かない運用にすること（画面でも注意書きを出す）。
CREATE TABLE abuse_allowlist (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  rule TEXT,                        -- NULL = 全ルール
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL DEFAULT ''  -- 登録した運営管理者の user id（FKは張らない）
);
-- 同じ user × rule を二重登録させない（rule NULL は '' に寄せて比較する）
CREATE UNIQUE INDEX idx_abuse_allowlist_key
  ON abuse_allowlist(user_id, COALESCE(rule, ''));
-- 一覧（新しい順）
CREATE INDEX idx_abuse_allowlist_created ON abuse_allowlist(created_at DESC);

-- 検知バッチが毎日歩く範囲を絞るためのインデックス (#259 レビュー反映)。
--
-- D1 は rows_read 課金なので、created_at の範囲検索が SCAN のままだと
-- イベント3万・member 33万・like 60万規模でルール1本あたり数十万行を読む。
-- 既存インデックス（event(status) / event_member(event_id) / event_member(user_id) /
-- event_comment(event_id, created_at) / event_like(event_id, kind) /
-- event_like(kind, target_key) / event_request(status, created_at) など）は
-- いずれも先頭列が created_at ではないため、created_at の範囲検索には使えない。
--
-- 本番と同じ形（2年ぶんに散らしたイベント3万・member 33万・like 60万・
-- comment 20万・user 2万）の SQLite で EXPLAIN QUERY PLAN と実測を取り、
-- SCAN が SEARCH に変わることを確認したものだけを入れてある（インデックス無し → 有り）:
--   cancel_burst 383ms → 15ms / comment_burst 107ms → 2ms /
--   event_burst 3ms → 0.5ms / new_account_burst 2ms → 0.1ms /
--   empty_event_spam 2ms → 0.4ms / signup_spike 2ms → 0.3ms
-- （インデックス無しの cancel_burst は、OR での絞り込みだった修正前だと 598ms）

-- event_burst / empty_event_spam / new_account_burst の created_at 範囲検索。
-- event(created_by) 側のインデックスは **あえて足していない**。足すと SQLite が
-- event_burst でも GROUP BY を作らずに済むそちらを選び、7日ぶんの範囲検索から
-- event 全件の走査に化ける（実測 0.1ms → 5ms・読み取り3万行）。
-- new_account_burst 側は e.created_at にも下限を置くことで、このインデックス
-- 1本だけで SEARCH になる（detectNewAccountBurst のコメント参照）
CREATE INDEX idx_event_created_at ON event(created_at);
-- cancel_burst の母数（直近30日に作成された参加登録）
CREATE INDEX idx_event_member_created_at ON event_member(created_at);
-- cancel_burst の分子（直近7日にキャンセルされた登録）。
-- キャンセル行は全体のごく一部なので部分インデックスにする
CREATE INDEX idx_event_member_canceled_at ON event_member(canceled_at)
  WHERE canceled_at IS NOT NULL;
-- comment_burst のコメント側
CREATE INDEX idx_event_comment_created_at ON event_comment(created_at);
-- comment_burst のいいね側。kind='event' だけを数えるので先頭列を kind にする
-- （既存の event_like(kind, target_key) は2列目が違うので範囲検索に使えない）
CREATE INDEX idx_event_like_kind_created_at ON event_like(kind, created_at);
-- egg_burst
CREATE INDEX idx_event_request_created_at ON event_request(created_at);
-- signup_spike のベースライン集計
CREATE INDEX idx_user_created_at ON user(created_at);
